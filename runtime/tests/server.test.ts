import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '../src/server.js'
import type { Runtime, Workspace, WorkspaceConfig } from '../src/types.js'
import { WorkspaceNotFoundError } from '../src/types.js'

// ---------------------------------------------------------------------------
// Mock Runtime
// ---------------------------------------------------------------------------

function mockRuntime(): Runtime {
  const workspaces = new Map<string, Workspace>()

  return {
    createWorkspace: vi.fn(async (config: WorkspaceConfig) => {
      const ws: Workspace = {
        id: crypto.randomUUID(),
        userId: config.userId,
        containerId: 'container-' + Math.random().toString(36).slice(2, 10),
        containerName: `koda-${config.userId}`,
        status: 'running',
        agent: config.agent ?? 'opencode',
        createdAt: new Date(),
      }
      workspaces.set(ws.id, ws)
      return ws
    }),

    startWorkspace: vi.fn(async (id: string) => {
      const ws = workspaces.get(id)
      if (!ws) throw new WorkspaceNotFoundError(id)
      ws.status = 'running'
    }),

    stopWorkspace: vi.fn(async (id: string) => {
      const ws = workspaces.get(id)
      if (!ws) throw new WorkspaceNotFoundError(id)
      ws.status = 'stopped'
    }),

    destroyWorkspace: vi.fn(async (id: string) => {
      const ws = workspaces.get(id)
      if (!ws) throw new WorkspaceNotFoundError(id)
      workspaces.delete(id)
    }),

    getWorkspace: vi.fn(async (id: string) => workspaces.get(id) ?? null),

    getWorkspaceByUserId: vi.fn(async () => null),

    listWorkspaces: vi.fn(async () => [...workspaces.values()]),

    connectACP: vi.fn(async () => ({
      stdin: new WritableStream(),
      stdout: new ReadableStream(),
    })),

    syncFromDocker: vi.fn(async () => 0),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runtime HTTP server', () => {
  let runtime: ReturnType<typeof mockRuntime>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    runtime = mockRuntime()
    app = createApp(runtime, 'test-key')
  })

  // --- Health ---

  describe('GET /health', () => {
    it('returns 200 without auth', async () => {
      const res = await app.request('/health')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'ok' })
    })
  })

  // --- Auth ---

  describe('authentication', () => {
    it('rejects requests without auth header', async () => {
      const res = await app.request('/workspaces')
      expect(res.status).toBe(401)
    })

    it('rejects requests with wrong auth', async () => {
      const res = await app.request('/workspaces', {
        headers: { Authorization: 'Bearer wrong-key' },
      })
      expect(res.status).toBe(401)
    })

    it('allows requests with correct auth', async () => {
      const res = await app.request('/workspaces', {
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(200)
    })

    it('skips auth when no API key configured', async () => {
      const noAuthApp = createApp(runtime)
      const res = await noAuthApp.request('/workspaces')
      expect(res.status).toBe(200)
    })
  })

  // --- POST /workspaces ---

  describe('POST /workspaces', () => {
    it('creates a workspace and returns 201', async () => {
      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ userId: 'user-1' }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.workspace).toBeDefined()
      expect(body.workspace.userId).toBe('user-1')
      expect(body.workspace.status).toBe('running')
      expect(runtime.createWorkspace).toHaveBeenCalledWith({ userId: 'user-1' })
    })

    it('returns 400 when userId is missing', async () => {
      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when agent is not in the allowlist', async () => {
      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ userId: 'user-1', agent: 'rm -rf /' }),
      })
      expect(res.status).toBe(400)
      expect(runtime.createWorkspace).not.toHaveBeenCalled()
    })

    it('passes a valid agent selection through to the runtime', async () => {
      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ userId: 'user-1', agent: 'omp' }),
      })
      expect(res.status).toBe(201)
      expect(runtime.createWorkspace).toHaveBeenCalledWith({ userId: 'user-1', agent: 'omp' })
    })

    it('returns 500 when createWorkspace throws', async () => {
      vi.mocked(runtime.createWorkspace).mockRejectedValueOnce(new Error('Docker error'))
      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ userId: 'user-1' }),
      })
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe('Docker error')
    })
  })

  // --- GET /workspaces ---

  describe('GET /workspaces', () => {
    it('returns empty list when no workspaces', async () => {
      const res = await app.request('/workspaces', {
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.workspaces).toEqual([])
    })

    it('returns all workspaces', async () => {
      // Create two workspaces
      await runtime.createWorkspace({ userId: 'a' })
      await runtime.createWorkspace({ userId: 'b' })

      const res = await app.request('/workspaces', {
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.workspaces).toHaveLength(2)
    })
  })

  // --- GET /workspaces/:id ---

  describe('GET /workspaces/:id', () => {
    it('returns workspace by ID', async () => {
      const ws = await runtime.createWorkspace({ userId: 'user-1' })
      const res = await app.request(`/workspaces/${ws.id}`, {
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.workspace.id).toBe(ws.id)
    })

    it('returns 404 for unknown ID', async () => {
      const res = await app.request('/workspaces/nonexistent', {
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(404)
    })
  })

  // --- POST /workspaces/:id/start ---

  describe('POST /workspaces/:id/start', () => {
    it('starts workspace and returns 200', async () => {
      const ws = await runtime.createWorkspace({ userId: 'user-1' })
      await runtime.stopWorkspace(ws.id)

      const res = await app.request(`/workspaces/${ws.id}/start`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('started')
    })

    it('returns 404 for unknown workspace', async () => {
      const res = await app.request('/workspaces/nonexistent/start', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(404)
    })
  })

  // --- POST /workspaces/:id/stop ---

  describe('POST /workspaces/:id/stop', () => {
    it('stops workspace and returns 200', async () => {
      const ws = await runtime.createWorkspace({ userId: 'user-1' })

      const res = await app.request(`/workspaces/${ws.id}/stop`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('stopped')
    })

    it('returns 404 for unknown workspace', async () => {
      const res = await app.request('/workspaces/nonexistent/stop', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(404)
    })
  })

  // --- DELETE /workspaces/:id ---

  describe('DELETE /workspaces/:id', () => {
    it('destroys workspace and returns 204', async () => {
      const ws = await runtime.createWorkspace({ userId: 'user-1' })

      const res = await app.request(`/workspaces/${ws.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(204)

      // Verify it's gone
      const getRes = await app.request(`/workspaces/${ws.id}`, {
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(getRes.status).toBe(404)
    })

    it('returns 404 for unknown workspace', async () => {
      const res = await app.request('/workspaces/nonexistent', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-key' },
      })
      expect(res.status).toBe(404)
    })
  })

  // --- Prompt (the streaming agent seam) ---

  describe('POST /workspaces/:id/prompt', () => {
    const AUTH = {
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    }

    // The vendored capture is the protocol authority: replay its exact
    // server lines. Fixture ids 1–4 match the client's request id sequence
    // (initialize, authenticate, session/new, session/prompt).
    const fixtureMessages = readFileSync(
      new URL('./fixtures/opencode_acp_observed_toolcall_flow.jsonl', import.meta.url),
      'utf8',
    )
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l).message)
    const respFor = (id: number) => fixtureMessages.find((m) => m.id === id && m.result)
    const promptUpdates = fixtureMessages.filter((m) => m.method === 'session/update')

    /**
     * A scripted in-memory ACP agent. Replies to the protocol sequence from
     * the fixture, delivering the whole prompt turn COALESCED in one chunk —
     * multiple nd-JSON lines per read, the class of framing the wire really
     * produces.
     */
    function scriptedConnectACP(opts: { holdPrompt?: () => Promise<void> } = {}) {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const stdout = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
        },
      })
      const sendCoalesced = (msgs: object[]) =>
        controller.enqueue(encoder.encode(msgs.map((m) => JSON.stringify(m) + '\n').join('')))
      let buf = ''
      const stdin = new WritableStream<Uint8Array>({
        async write(chunk) {
          buf += decoder.decode(chunk)
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            const msg = JSON.parse(line)
            switch (msg.method) {
              case 'initialize':
                sendCoalesced([respFor(1)!])
                break
              case 'authenticate':
                sendCoalesced([respFor(2)!])
                break
              case 'session/new':
                sendCoalesced([respFor(3)!])
                break
              case 'session/prompt':
                if (opts.holdPrompt) await opts.holdPrompt()
                sendCoalesced([...promptUpdates, respFor(4)!])
                break
            }
          }
        },
      })
      return { stdin, stdout }
    }

    async function createWs(): Promise<string> {
      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ userId: 'prompt-user' }),
      })
      return (await res.json()).workspace.id
    }

    it('streams the fixture events in wire order and terminates with a result line', async () => {
      runtime.connectACP = vi.fn(async () => scriptedConnectACP())
      const id = await createWs()

      const res = await app.request(`/workspaces/${id}/prompt`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ text: 'create hello.txt' }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('ndjson')

      const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
      const last = lines[lines.length - 1]
      expect(last.type).toBe('result')
      expect(last.stopReason).toBe('end_turn')
      expect(typeof last.content).toBe('string')
      expect(last.content.length).toBeGreaterThan(0)

      // 3 tools × (tool_call + in_progress + completed), in fixture order.
      const toolLines = lines.filter((l) => l.type === 'tool_call' || l.type === 'tool_call_update')
      expect(toolLines).toHaveLength(9)
      expect(toolLines[0]).toMatchObject({ type: 'tool_call', title: 'glob', status: 'pending' })
      expect(toolLines[5]).toMatchObject({
        type: 'tool_call_update',
        title: 'workspace/hello.txt',
        kind: 'edit',
        status: 'completed',
      })
      // Thoughts stream too (streamThoughts is on for the depth path).
      expect(lines.some((l) => l.type === 'thought_chunk')).toBe(true)
      // Events precede the terminal line — the stream is live, not batched.
      expect(lines.findIndex((l) => l.type === 'tool_call')).toBeLessThan(lines.length - 1)
    })

    it('rejects an overlapping prompt with 409, then allows the next one', async () => {
      let release!: () => void
      const gate = new Promise<void>((r) => {
        release = r
      })
      let first = true
      runtime.connectACP = vi.fn(async () =>
        scriptedConnectACP({ holdPrompt: first ? ((first = false), () => gate) : undefined }),
      )
      const id = await createWs()

      const p1 = app.request(`/workspaces/${id}/prompt`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ text: 'long job' }),
      })
      await new Promise((r) => setTimeout(r, 25))

      const res2 = await app.request(`/workspaces/${id}/prompt`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ text: 'overlap' }),
      })
      expect(res2.status).toBe(409)

      release()
      const res1 = await p1
      expect(res1.status).toBe(200)
      await res1.text()

      const res3 = await app.request(`/workspaces/${id}/prompt`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ text: 'after' }),
      })
      expect(res3.status).toBe(200)
      await res3.text()
    })

    it('returns 404 for an unknown workspace', async () => {
      const res = await app.request('/workspaces/nonexistent/prompt', {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ text: 'hi' }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 400 when text is missing', async () => {
      runtime.connectACP = vi.fn(async () => scriptedConnectACP())
      const id = await createWs()
      const res = await app.request(`/workspaces/${id}/prompt`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('returns 401 without a bearer token', async () => {
      const res = await app.request('/workspaces/whatever/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hi' }),
      })
      expect(res.status).toBe(401)
    })
  })
})
