import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { Runtime, WorkspaceConfig } from './types.js'
import {
  WorkspaceNotFoundError,
  WorkspaceExistsError,
} from './types.js'
import { AcpClient } from './acp-client.js'

/** Generous prompt deadline — a model call can legitimately take minutes. */
const PROMPT_STREAM_TIMEOUT_MS = 240_000

/** Map a known error to an HTTP status. */
function errorToHttp(err: unknown): { status: number; message: string } {
  if (err instanceof WorkspaceNotFoundError) {
    return { status: 404, message: err.message }
  }
  if (err instanceof WorkspaceExistsError) {
    return { status: 409, message: err.message }
  }
  const message =
    err instanceof Error ? err.message : 'Internal server error'
  return { status: 500, message }
}

/**
 * Creates a Hono app that exposes the Runtime interface over HTTP.
 *
 * Auth: Bearer token via KODA_API_KEY env var (skipped on /health).
 */
export function createApp(runtime: Runtime, apiKey?: string): Hono {
  const app = new Hono()

  // One prompt per workspace at a time — the server-side mirror of the
  // gateway's one-job rule. Overlapping prompts would interleave writes on
  // the same container attach.
  const promptsInFlight = new Set<string>()

  // ---------------------------------------------------------------------------
  // Auth middleware — skip on /health
  // ---------------------------------------------------------------------------

  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next()

    if (!apiKey) {
      // No API key configured — auth disabled (dev mode)
      return next()
    }

    const auth = c.req.header('Authorization') ?? ''
    const expected = `Bearer ${apiKey}`
    const isValid = auth.length === expected.length &&
      timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
    if (!isValid) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return next()
  })

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  app.get('/health', (c) => c.json({ status: 'ok' }))

  // Create workspace
  app.post('/workspaces', async (c) => {
    const body = await c.req.json<WorkspaceConfig>()
    if (!body.userId) {
      return c.json({ error: 'userId is required' }, 400)
    }
    if (body.cpuLimit !== undefined && (body.cpuLimit < 0.5 || body.cpuLimit > 8)) {
      return c.json({ error: 'cpuLimit must be between 0.5 and 8' }, 400)
    }
    if (body.pidLimit !== undefined && (body.pidLimit < 1 || body.pidLimit > 10000)) {
      return c.json({ error: 'pidLimit must be between 1 and 10000' }, 400)
    }
    if (body.agent !== undefined && body.agent !== 'opencode' && body.agent !== 'omp') {
      return c.json({ error: "agent must be 'opencode' or 'omp'" }, 400)
    }

    try {
      const workspace = await runtime.createWorkspace(body)
      return c.json({ workspace }, 201)
    } catch (err) {
      const { status, message } = errorToHttp(err)
      return c.json({ error: message }, status as 400 | 409 | 500)
    }
  })

  // List workspaces
  app.get('/workspaces', async (c) => {
    const workspaces = await runtime.listWorkspaces()
    return c.json({ workspaces })
  })

  // Get workspace by ID
  app.get('/workspaces/:id', async (c) => {
    const workspace = await runtime.getWorkspace(c.req.param('id'))
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404)
    }
    return c.json({ workspace })
  })

  // Start workspace
  app.post('/workspaces/:id/start', async (c) => {
    try {
      await runtime.startWorkspace(c.req.param('id'))
      return c.json({ status: 'started' })
    } catch (err) {
      const { status, message } = errorToHttp(err)
      return c.json({ error: message }, status as 404 | 500)
    }
  })

  // Stop workspace
  app.post('/workspaces/:id/stop', async (c) => {
    try {
      await runtime.stopWorkspace(c.req.param('id'))
      return c.json({ status: 'stopped' })
    } catch (err) {
      const { status, message } = errorToHttp(err)
      return c.json({ error: message }, status as 404 | 500)
    }
  })

  // Prompt the agent inside a workspace, streaming events as nd-JSON.
  //
  // The HTTP lifecycle routes manage boxes; this is the one seam that
  // reaches the agent — callers (the voice gateway) never touch Docker.
  // Response body: one JSON line per streamed AcpEvent (message_chunk /
  // thought_chunk / tool_call / tool_call_update / usage_update / plan),
  // terminated by {type:"result", content, stopReason} on success or
  // {type:"error", message} if the turn dies mid-stream.
  app.post('/workspaces/:id/prompt', async (c) => {
    const id = c.req.param('id')
    let body: { text?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const text = body?.text
    if (typeof text !== 'string' || !text.trim()) {
      return c.json({ error: 'text is required' }, 400)
    }

    const workspace = await runtime.getWorkspace(id)
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404)
    }
    if (promptsInFlight.has(id)) {
      return c.json({ error: 'a prompt is already in flight for this workspace' }, 409)
    }
    promptsInFlight.add(id)

    let acp: AcpClient | undefined
    try {
      const { stdin, stdout } = await runtime.connectACP(id)
      acp = new AcpClient(stdin, stdout, { promptTimeoutMs: PROMPT_STREAM_TIMEOUT_MS })

      const init = await acp.connect()
      const methods = ((init.result as any)?.authMethods ?? []).map((m: any) => m.id)
      if (methods.includes('opencode-login')) {
        await acp.authenticate('opencode-login')
      }
      const session = await acp.newSession('/workspace')

      const client = acp
      c.header('Content-Type', 'application/x-ndjson')
      return stream(c, async (out) => {
        // WritableStream queues unawaited writes in order, so firing from
        // the sync onEvent callback preserves wire order. Write failures
        // (client went away) are swallowed — the turn still finishes and
        // the finally releases the workspace.
        const writeLine = (obj: unknown) =>
          out.write(JSON.stringify(obj) + '\n').catch(() => {})
        try {
          const result = await client.prompt(session.id, text, {
            streamThoughts: true,
            onEvent: (event) => {
              void writeLine(event)
            },
          })
          await writeLine({ type: 'result', content: result.content, stopReason: result.stopReason })
        } catch (err) {
          await writeLine({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        } finally {
          client.close()
          promptsInFlight.delete(id)
        }
      })
    } catch (err) {
      // Handshake failed before any line was streamed — plain JSON error.
      acp?.close()
      promptsInFlight.delete(id)
      const { status, message } = errorToHttp(err)
      return c.json({ error: message }, status as 404 | 500)
    }
  })

  // Destroy workspace
  app.delete('/workspaces/:id', async (c) => {
    try {
      await runtime.destroyWorkspace(c.req.param('id'))
      return c.body(null, 204)
    } catch (err) {
      const { status, message } = errorToHttp(err)
      return c.json({ error: message }, status as 404 | 500)
    }
  })

  return app
}
