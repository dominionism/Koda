/**
 * ACP client for communicating with OpenCode inside containers.
 *
 * Wraps the raw Web Streams returned by `Runtime.connectACP` and handles
 * the nd-JSON framing, protocol sequence, and streaming.
 *
 * The wire shapes follow the sessions recorded from real OpenCode 1.17.11
 * over ACP — see `tests/fixtures/opencode_acp_observed_session_flow.jsonl`
 * (vendored from Koda-Backend `operator/tests/fixtures/`, the protocol
 * authority both repos share) and `opencode_acp_observed_toolcall_flow.jsonl`
 * (a tool-call flow captured live in the koda-runtime container).
 *
 * Usage:
 *
 * ```typescript
 * const { stdin, stdout } = await runtime.connectACP(workspace.id)
 * const acp = new AcpClient(stdin, stdout)
 *
 * await acp.connect()
 * const session = await acp.newSession('/workspace')
 * const reply = await acp.prompt(session.id, 'What is 2+2?')
 * console.log(reply.content) // "4"
 *
 * acp.close()
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A JSON-RPC message sent to or received from the ACP server. */
export interface AcpMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

/** Result returned by `AcpClient.prompt()`. */
export interface PromptResult {
  /** The agent's text response (concatenated `agent_message_chunk` texts). */
  content: string
  /** Why the agent stopped: 'end_turn' or 'max_tokens'. */
  stopReason: string
  /** Token usage for this prompt. */
  usage: { inputTokens: number; outputTokens: number }
  /** Streaming message chunks collected during generation. */
  chunks: string[]
  /** Tool calls observed during this prompt, in wire order. */
  toolCalls: ToolCallEvent[]
}

/**
 * A tool-call event from the update stream.
 *
 * Field names follow the live capture in
 * `tests/fixtures/opencode_acp_observed_toolcall_flow.jsonl`: `tool_call`
 * announces a tool with `status: "pending"`; `tool_call_update` carries
 * progress, and completed updates add `content` (nested content blocks).
 * The wire also carries `locations`/`rawInput`/`rawOutput`, which this
 * client does not surface.
 */
export interface ToolCallEvent {
  type: 'tool_call' | 'tool_call_update'
  /** Wire `toolCallId` — correlates a call with its updates. */
  id?: string
  /** Tool label, e.g. 'glob', 'read', 'workspace/hello.txt'. */
  title?: string
  /** Tool category: 'search' | 'read' | 'edit' | … */
  kind?: string
  /** 'pending' | 'in_progress' | 'completed' | … */
  status?: string
  /** Present on completed updates: nested content blocks. */
  content?: unknown
  /**
   * ACP-standard `[{ path, line? }]` of the files a tool touches. The
   * agent-agnostic path source: OpenCode repeats the path in `title` on
   * completion, but OMP describes its tools in prose (`title: "Create
   * hello.txt"`) and omits `title` on completion — `locations` is where a
   * narrator finds the filename for either agent. Announced on the pending
   * `tool_call`.
   */
  locations?: unknown
}

/** Streaming events surfaced through `PromptOptions.onEvent`. */
export type AcpEvent =
  | { type: 'message_chunk'; text: string }
  | { type: 'thought_chunk'; text: string }
  | ToolCallEvent
  | { type: 'usage_update'; used: number }
  | { type: 'plan'; entries: unknown }

/** Options for `AcpClient.prompt()`. */
export interface PromptOptions {
  /** Fired for each streaming event, in wire order. */
  onEvent?: (event: AcpEvent) => void
  /**
   * Forward internal reasoning (`agent_thought_chunk`) as `thought_chunk`
   * events. Off by default — thoughts are not user-visible content.
   */
  streamThoughts?: boolean
}

/** Timeouts for the client. Both default to the module constants. */
export interface AcpClientOptions {
  /** Max wait for a `session/prompt` to complete (default 5 minutes). */
  promptTimeoutMs?: number
  /** Max wait for non-prompt requests like `initialize` (default 30 seconds). */
  requestTimeoutMs?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time to wait for a prompt response before throwing (5 minutes). */
const PROMPT_TIMEOUT_MS = 300_000

/** Maximum time to wait for a non-prompt response before throwing. */
const REQUEST_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// AcpClient
// ---------------------------------------------------------------------------

/**
 * High-level ACP client that speaks the OpenCode protocol.
 *
 * Handles nd-JSON framing, the required protocol sequence
 * (initialize → session/new → session/prompt), and streaming responses.
 *
 * Does NOT own the connection lifecycle — the caller creates and
 * destroys the streams.
 */
export class AcpClient {
  private readonly stdin: WritableStream
  private readonly stdout: ReadableStream
  private readonly encoder = new TextEncoder()
  private readonly decoder = new TextDecoder()
  private readonly promptTimeoutMs: number
  private readonly requestTimeoutMs: number
  private nextId = 1
  private buffer = ''
  private closed = false

  constructor(stdin: WritableStream, stdout: ReadableStream, options: AcpClientOptions = {}) {
    this.stdin = stdin
    this.stdout = stdout
    this.promptTimeoutMs = options.promptTimeoutMs ?? PROMPT_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  }

  // -------------------------------------------------------------------------
  // Protocol methods
  // -------------------------------------------------------------------------

  /**
   * Initialize the ACP connection.
   *
   * Must be called before `newSession` or `prompt`.
   * Sends the `initialize` request and waits for the server's response.
   */
  async connect(): Promise<AcpMessage> {
    return this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'koda-runtime', version: '0.1.0' },
    })
  }

  /**
   * Authenticate with an advertised auth method.
   *
   * OpenCode advertises `opencode-login`. Inside the runtime container the
   * provider credentials arrive as env vars, so this is a handshake, not an
   * interactive login.
   */
  async authenticate(methodId: string): Promise<AcpMessage> {
    return this.request('authenticate', { methodId })
  }

  /**
   * Create a new coding session rooted at `cwd`.
   *
   * The protocol requires `cwd` on `session/new`; for runtime containers
   * that is the workspace mount, `/workspace`.
   *
   * Returns the session ID to pass to `prompt`.
   */
  async newSession(cwd: string): Promise<{ id: string }> {
    const res = await this.request('session/new', { cwd, mcpServers: [] })
    const id = (res.result as any)?.sessionId
    if (typeof id !== 'string') {
      throw new Error(`session/new did not return a sessionId: ${JSON.stringify(res)}`)
    }
    return { id }
  }

  /**
   * Send a user message and wait for the agent's response.
   *
   * The prompt travels as text content blocks (`prompt: [{type, text}]`) —
   * the shape real OpenCode accepts. The final response carries no text;
   * the answer arrives as `agent_message_chunk` updates, collected into
   * `result.chunks` and concatenated into `result.content`. Tool calls are
   * collected into `result.toolCalls`, and `options.onEvent` streams every
   * event in wire order for real-time narration.
   */
  async prompt(sessionId: string, text: string, options: PromptOptions = {}): Promise<PromptResult> {
    const { onEvent, streamThoughts = false } = options
    const chunks: string[] = []
    const toolCalls: ToolCallEvent[] = []
    let content = ''
    let stopReason = 'end_turn'
    let usage = { inputTokens: 0, outputTokens: 0 }

    const id = await this.send('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    })
    const deadline = Date.now() + this.promptTimeoutMs

    while (true) {
      const msg = await this.read(deadline)

      // Notifications (no id) nest their payload under `params.update`.
      if (msg.id === undefined && msg.method === 'session/update') {
        const update = (msg.params as any)?.update
        const kind = update?.sessionUpdate

        if (kind === 'agent_message_chunk') {
          const chunk = update?.content?.text
          if (typeof chunk === 'string') {
            chunks.push(chunk)
            onEvent?.({ type: 'message_chunk', text: chunk })
          }
        } else if (kind === 'agent_thought_chunk') {
          const thought = update?.content?.text
          if (streamThoughts && typeof thought === 'string') {
            onEvent?.({ type: 'thought_chunk', text: thought })
          }
        } else if (kind === 'tool_call' || kind === 'tool_call_update') {
          const event: ToolCallEvent = {
            type: kind,
            id: update?.toolCallId,
            title: update?.title,
            kind: update?.kind,
            status: update?.status,
            content: update?.content,
            locations: update?.locations,
          }
          toolCalls.push(event)
          onEvent?.(event)
        } else if (kind === 'plan') {
          // Spec field is `entries`; no plan event has been observed live
          // yet (absent from both vendored captures) — shape unconfirmed.
          onEvent?.({ type: 'plan', entries: update?.entries ?? [] })
        } else if (kind === 'usage_update' && typeof update?.used === 'number') {
          // Context-window fill, not final token counts — the final
          // response's `usage` stays authoritative for PromptResult.
          onEvent?.({ type: 'usage_update', used: update.used })
        }
        // Anything else (available_commands_update, …) is protocol noise.
        continue
      }

      // Final response (has our id and stopReason).
      if (msg.id === id) {
        if (msg.error) {
          throw new Error(`ACP error: ${msg.error.message} (code ${msg.error.code})`)
        }
        content = chunks.join('')
        stopReason = (msg.result as any)?.stopReason ?? 'end_turn'
        const u = (msg.result as any)?.usage
        if (u) {
          usage = { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 }
        }
        return { content, stopReason, usage, chunks, toolCalls }
      }

      // Unexpected response id — log but keep waiting.
      if (msg.id !== undefined) {
        console.warn(`[acp] unexpected response id=${msg.id}, expected ${id}`)
      }
    }
  }

  /** Notify the agent to cancel the session's in-flight work. */
  async cancel(sessionId: string): Promise<void> {
    await this.notify('session/cancel', { sessionId })
  }

  /**
   * Release the streams.
   *
   * Does NOT destroy the workspace — the caller owns that.
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    try { this.stdin.abort() } catch { /* already closed */ }
    try { this.stdout.cancel() } catch { /* already closed */ }
  }

  // -------------------------------------------------------------------------
  // Internal nd-JSON transport
  // -------------------------------------------------------------------------

  /** Send a JSON-RPC request and return its id. */
  private async send(method: string, params: Record<string, unknown>): Promise<number> {
    const id = this.nextId++
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    const writer = this.stdin.getWriter()
    await writer.write(this.encoder.encode(msg))
    writer.releaseLock()
    return id
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'
    const writer = this.stdin.getWriter()
    await writer.write(this.encoder.encode(msg))
    writer.releaseLock()
  }

  /** Send a request and wait for the matching response. */
  private async request(method: string, params: Record<string, unknown>): Promise<AcpMessage> {
    const id = await this.send(method, params)
    const deadline = Date.now() + this.requestTimeoutMs
    while (true) {
      const msg = await this.read(deadline)
      if (msg.id === id) return msg
      // Skip notifications — they're streaming updates, not our response.
    }
  }

  /** Read the next complete JSON line from stdout, bounded by `deadline`. */
  private async read(deadline?: number): Promise<AcpMessage> {
    const reader = this.stdout.getReader()
    try {
      while (true) {
        // Take ONE complete line off the buffer, preserving the rest — a
        // single stream chunk routinely carries several nd-JSON lines
        // (OpenCode emits usage_update and the final response microseconds
        // apart, and the transport coalesces them).
        const nl = this.buffer.indexOf('\n')
        if (nl >= 0) {
          const line = this.buffer.slice(0, nl).trim()
          this.buffer = this.buffer.slice(nl + 1)
          if (line) return JSON.parse(line) as AcpMessage
          continue
        }

        // No complete line buffered — read more from the stream.
        const { value, done } = await this.readChunk(reader, deadline)
        if (done) throw new Error('ACP stream closed unexpectedly')
        this.buffer += this.decoder.decode(value, { stream: true })
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * One stream read, rejected once `deadline` passes — a silent container
   * must surface as a timeout, never a hang.
   */
  private async readChunk(reader: any, deadline?: number): Promise<any> {
    if (deadline === undefined) return reader.read()
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('ACP read timed out')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`ACP read timed out after ${remaining}ms`)),
            remaining,
          )
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
