import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { AcpClient } from '../src/acp-client.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a pair of streams for testing.
 *
 * - writeToStdout(json) — push a JSON-RPC message into the client's read side
 * - getStdinMessages()  — return all messages the client wrote to stdin
 */
function createStreams() {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // Collect what the client writes to stdin.
  const stdinChunks: Uint8Array[] = []
  const stdinMessages: string[] = []

  const stdin = new WritableStream({
    write(chunk) {
      stdinChunks.push(chunk)
      const text = decoder.decode(chunk)
      for (const line of text.split('\n')) {
        if (line.trim()) stdinMessages.push(line.trim())
      }
    },
  })

  // Let us push responses into the client's stdout.
  let stdoutController: ReadableStreamDefaultController<Uint8Array>
  const stdout = new ReadableStream({
    start(ctrl) {
      stdoutController = ctrl
    },
  })

  function writeToStdout(msg: object) {
    stdoutController.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))
  }

  /** Deliver several messages in ONE stream chunk, as TCP coalescing does. */
  function writeToStdoutCoalesced(...msgs: object[]) {
    stdoutController.enqueue(encoder.encode(msgs.map((m) => JSON.stringify(m) + '\n').join('')))
  }

  /** Deliver raw bytes — for lines split across chunk boundaries. */
  function writeToStdoutRaw(text: string) {
    stdoutController.enqueue(encoder.encode(text))
  }

  function closeStdout() {
    stdoutController.close()
  }

  function getStdinMessages(): any[] {
    return stdinMessages.map((m) => JSON.parse(m))
  }

  return { stdin, stdout, writeToStdout, writeToStdoutCoalesced, writeToStdoutRaw, closeStdout, getStdinMessages }
}

/** A nested session/update notification, as real OpenCode emits them. */
function messageChunk(sessionId: string, text: string) {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AcpClient', () => {
  it('sends initialize with protocolVersion, clientCapabilities, and clientInfo', async () => {
    const { stdin, stdout, writeToStdout, getStdinMessages } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    // Respond to initialize (id: 1)
    writeToStdout({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: 1,
        agentInfo: { name: 'OpenCode', version: '1.17.11' },
        agentCapabilities: {},
      },
    })

    const res = await acp.connect()
    const msgs = getStdinMessages()

    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientInfo: { name: 'koda-runtime', version: '0.1.0' },
      },
    })
    // The protocol field is clientCapabilities — `capabilities` does not exist.
    expect(msgs[0].params).toHaveProperty('clientCapabilities')
    expect(msgs[0].params).not.toHaveProperty('capabilities')
    expect(res.result).toBeDefined()
    acp.close()
  })

  it('sends authenticate with the advertised methodId', async () => {
    const { stdin, stdout, writeToStdout, getStdinMessages } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    writeToStdout({ jsonrpc: '2.0', id: 2, result: {} })
    await acp.authenticate('opencode-login')

    const msgs = getStdinMessages()
    expect(msgs[1]).toMatchObject({ method: 'authenticate', params: { methodId: 'opencode-login' } })
    acp.close()
  })

  it('creates a session with cwd and returns sessionId', async () => {
    const { stdin, stdout, writeToStdout, getStdinMessages } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    // Mock initialize
    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    // Mock session/new
    writeToStdout({ jsonrpc: '2.0', id: 2, result: { sessionId: 'sess-abc' } })
    const session = await acp.newSession('/workspace')

    expect(session.id).toBe('sess-abc')

    // The protocol requires cwd on session/new (observed: -32602 without it).
    const msgs = getStdinMessages()
    expect(msgs[1]).toMatchObject({
      method: 'session/new',
      params: { cwd: '/workspace', mcpServers: [] },
    })
    acp.close()
  })

  it('throws when session/new returns no sessionId', async () => {
    const { stdin, stdout, writeToStdout } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    // Session/new returns empty result
    writeToStdout({ jsonrpc: '2.0', id: 2, result: {} })

    await expect(acp.newSession('/workspace')).rejects.toThrow('did not return a sessionId')
    acp.close()
  })

  it('sends prompt as content blocks and concatenates nested message chunks', async () => {
    const { stdin, stdout, writeToStdout, getStdinMessages } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    // Initialize
    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    // Prompt — streaming chunks then final response
    const promptPromise = acp.prompt('sess-1', 'Hello')

    // Give the prompt request time to be sent
    await new Promise((r) => setTimeout(r, 10))

    // Streaming updates arrive nested under params.update; thought chunks
    // must not leak into user-visible content.
    writeToStdout(messageChunk('sess-1', 'Hel'))
    writeToStdout({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'pondering…' } } },
    })
    writeToStdout(messageChunk('sess-1', 'lo!'))

    // Final response (id: 2 = the prompt request id, since connect consumed id 1)
    writeToStdout({
      jsonrpc: '2.0',
      id: 2,
      result: { stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
    })

    const result = await promptPromise

    expect(result.content).toBe('Hello!')
    expect(result.stopReason).toBe('end_turn')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(result.chunks).toEqual(['Hel', 'lo!'])

    // The wire shape is prompt content blocks — `message` does not exist.
    const sent = getStdinMessages()[1]
    expect(sent).toMatchObject({
      method: 'session/prompt',
      params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'Hello' }] },
    })
    expect(sent.params).not.toHaveProperty('message')
    acp.close()
  })

  it('handles prompt without streaming chunks', async () => {
    const { stdin, stdout, writeToStdout } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    const promptPromise = acp.prompt('sess-1', 'Hi')
    await new Promise((r) => setTimeout(r, 10))

    // Direct response, no streaming (id: 2 = prompt request id)
    writeToStdout({
      jsonrpc: '2.0',
      id: 2,
      result: { stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } },
    })

    const result = await promptPromise

    expect(result.content).toBe('')
    expect(result.chunks).toEqual([])
    acp.close()
  })

  it('does not lose the response when it shares a stream chunk with notifications', async () => {
    // Live wire truth: OpenCode emits usage_update and the final response
    // microseconds apart, and the transport routinely delivers them in one
    // chunk (observed same-millisecond on the wire). Every complete line in
    // a chunk must be consumed — a parse that returns the first line and
    // re-buffers only the trailing partial drops the response, and the
    // prompt then hangs until its deadline.
    const { stdin, stdout, writeToStdout, writeToStdoutCoalesced } = createStreams()
    const acp = new AcpClient(stdin, stdout, { promptTimeoutMs: 500 })

    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    const events: any[] = []
    const promptPromise = acp.prompt('sess-1', '2+2?', { onEvent: (e) => events.push(e) })
    await new Promise((r) => setTimeout(r, 10))

    // One chunk, three complete lines: message chunk + usage_update + response.
    writeToStdoutCoalesced(
      messageChunk('sess-1', '4'),
      { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'usage_update', used: 7976 } } },
      { jsonrpc: '2.0', id: 2, result: { stopReason: 'end_turn', usage: { inputTokens: 40, outputTokens: 4 } } },
    )

    const result = await promptPromise
    expect(result.content).toBe('4')
    expect(result.chunks).toEqual(['4'])
    expect(result.stopReason).toBe('end_turn')
    expect(events).toContainEqual({ type: 'message_chunk', text: '4' })
    expect(events).toContainEqual({ type: 'usage_update', used: 7976 })
    acp.close()
  })

  it('handles a complete line and a split line arriving in the same chunk', async () => {
    const { stdin, stdout, writeToStdout, writeToStdoutRaw } = createStreams()
    const acp = new AcpClient(stdin, stdout, { promptTimeoutMs: 500 })

    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    const promptPromise = acp.prompt('sess-1', 'Hi')
    await new Promise((r) => setTimeout(r, 10))

    // Chunk 1: a complete notification plus the FIRST HALF of the response
    // line. Chunk 2: the rest. The split must survive the coalesced parse.
    const notification = JSON.stringify(messageChunk('sess-1', 'Hi!'))
    const response = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: { stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } },
    })
    writeToStdoutRaw(notification + '\n' + response.slice(0, 25))
    await new Promise((r) => setTimeout(r, 10))
    writeToStdoutRaw(response.slice(25) + '\n')

    const result = await promptPromise
    expect(result.content).toBe('Hi!')
    expect(result.stopReason).toBe('end_turn')
    acp.close()
  })

  it('sends session/cancel as a notification without an id', async () => {
    const { stdin, stdout, writeToStdout, getStdinMessages } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    await acp.cancel('sess-1')

    const msgs = getStdinMessages()
    expect(msgs[1]).toMatchObject({ method: 'session/cancel', params: { sessionId: 'sess-1' } })
    expect(msgs[1].id).toBeUndefined()
    acp.close()
  })

  it('throws on ACP error response', async () => {
    const { stdin, stdout, writeToStdout } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    const promptPromise = acp.prompt('sess-1', 'Bad')
    await new Promise((r) => setTimeout(r, 10))

    // Error response (id: 2 = prompt request id)
    writeToStdout({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32000, message: 'session not found' },
    })

    await expect(promptPromise).rejects.toThrow('ACP error: session not found')
    acp.close()
  })

  it('throws when stdout closes unexpectedly', async () => {
    const { stdin, stdout, writeToStdout, closeStdout } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    // Close the stream cleanly — next read should throw
    closeStdout()

    await expect(acp.connect()).rejects.toThrow('stream closed unexpectedly')
    acp.close()
  })

  it('times out instead of hanging when the stream stays silent', async () => {
    const { stdin, stdout } = createStreams()
    const acp = new AcpClient(stdin, stdout, { requestTimeoutMs: 50 })

    // No response is ever pushed — connect must reject, not hang.
    await expect(acp.connect()).rejects.toThrow(/timed out/)
    acp.close()
  })

  it('prompt times out when no response arrives before the deadline', async () => {
    const { stdin, stdout, writeToStdout } = createStreams()
    const acp = new AcpClient(stdin, stdout, { promptTimeoutMs: 50 })

    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })
    await acp.connect()

    await expect(acp.prompt('sess-1', 'Hello')).rejects.toThrow(/timed out/)
    acp.close()
  })

  it('close is idempotent', () => {
    const { stdin, stdout } = createStreams()
    const acp = new AcpClient(stdin, stdout)
    acp.close()
    acp.close() // should not throw
  })

  it('skips notifications while waiting for a response', async () => {
    const { stdin, stdout, writeToStdout } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    // Send initialize with a notification mixed in
    writeToStdout({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'sess-0', update: { sessionUpdate: 'available_commands_update' } },
    })
    writeToStdout({ jsonrpc: '2.0', id: 1, result: {} })

    const res = await acp.connect()
    expect(res.id).toBe(1)
    expect(res.result).toBeDefined()
    acp.close()
  })
})

// ---------------------------------------------------------------------------
// Fixture replay — the shared protocol authority
// ---------------------------------------------------------------------------

describe('AcpClient fixture replay (opencode 1.17.11 observed session)', () => {
  const lines = readFileSync(new URL('./fixtures/opencode_acp_observed_session_flow.jsonl', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { direction: string; message: any })

  it('drives the exact recorded flow and emits the exact recorded client shapes', async () => {
    const { stdin, stdout, writeToStdout, getStdinMessages } = createStreams()
    const acp = new AcpClient(stdin, stdout)

    // Pre-buffer every agent→client message in recorded order; the client
    // must consume responses and skip notifications exactly as recorded.
    for (const { direction, message } of lines) {
      if (direction === 'agent_to_client') writeToStdout(message)
    }

    const init = await acp.connect()
    expect(init.result?.agentInfo).toMatchObject({ name: 'OpenCode' })

    await acp.authenticate('opencode-login')
    const session = await acp.newSession('<throwaway-project>')
    expect(session.id).toBe('ses_fixture_initialize_session')

    const reply = await acp.prompt(session.id, 'Koda safe fixture prompt.')
    expect(reply.stopReason).toBe('end_turn')
    expect(reply.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(reply.content).toBe('') // the safe run streamed no message chunks

    await acp.cancel(session.id)

    // Every client→agent message must match the recording: same methods,
    // same ids, and identical params for everything after initialize
    // (initialize differs only in clientInfo identity).
    const recorded = lines.filter((l) => l.direction === 'client_to_agent').map((l) => l.message)
    const sent = getStdinMessages()
    expect(sent).toHaveLength(recorded.length)
    for (let i = 0; i < recorded.length; i++) {
      expect(sent[i].method).toBe(recorded[i].method)
      expect(sent[i].id).toBe(recorded[i].id)
      if (recorded[i].method === 'initialize') {
        expect(Object.keys(sent[i].params).sort()).toEqual(Object.keys(recorded[i].params).sort())
        expect(sent[i].params.protocolVersion).toBe(recorded[i].params.protocolVersion)
      } else {
        expect(sent[i].params).toEqual(recorded[i].params)
      }
    }
    acp.close()
  })
})

// ---------------------------------------------------------------------------
// Tool-call fixture replay — the tool-event authority
// ---------------------------------------------------------------------------

describe('AcpClient tool-call replay (opencode 1.17.11 observed tool flow)', () => {
  const lines = readFileSync(new URL('./fixtures/opencode_acp_observed_toolcall_flow.jsonl', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { direction: string; message: any })

  async function driveRecordedFlow(options?: { onEvent?: (e: any) => void; streamThoughts?: boolean }) {
    const { stdin, stdout, writeToStdout } = createStreams()
    const acp = new AcpClient(stdin, stdout)
    for (const { direction, message } of lines) {
      if (direction === 'agent_to_client') writeToStdout(message)
    }
    await acp.connect()
    await acp.authenticate('opencode-login')
    const session = await acp.newSession('/workspace')
    const reply = await acp.prompt(session.id, 'Create a file named hello.txt containing exactly: hi', options)
    acp.close()
    return reply
  }

  it('surfaces tool_call/tool_call_update in wire order without touching content', async () => {
    const events: string[] = []
    const reply = await driveRecordedFlow({ onEvent: (e) => events.push(e.type) })

    expect(reply.stopReason).toBe('end_turn')
    expect(reply.usage).toEqual({ inputTokens: 122, outputTokens: 24 })

    // The recording carries 3 tool_call + 6 tool_call_update.
    expect(reply.toolCalls).toHaveLength(9)
    expect(reply.toolCalls.filter((t) => t.type === 'tool_call')).toHaveLength(3)
    expect(reply.toolCalls.filter((t) => t.type === 'tool_call_update')).toHaveLength(6)

    // The first call announces pending with the recorded identity fields.
    expect(reply.toolCalls[0]).toMatchObject({
      type: 'tool_call',
      id: 'call_d8ad572efc314b14934393eb',
      title: 'glob',
      kind: 'search',
      status: 'pending',
    })

    // `locations` is surfaced (the agent-agnostic path source). OpenCode's
    // recording reports it empty and carries the path in `title` instead; the
    // field must still be present so an OMP box — which populates it — is read
    // by the same code path.
    expect('locations' in reply.toolCalls[0]).toBe(true)
    expect(reply.toolCalls[0].locations).toEqual([])

    // Completed updates carry content; the recorded write tool completed.
    const completed = reply.toolCalls.filter((t) => t.type === 'tool_call_update' && t.status === 'completed')
    expect(completed.length).toBeGreaterThan(0)
    expect(completed.every((t) => t.content !== undefined)).toBe(true)
    expect(reply.toolCalls.some((t) => t.kind === 'edit' && t.status === 'completed')).toBe(true)

    // Message content is unchanged by tool events, and thoughts stay silent.
    expect(reply.content).toBe(reply.chunks.join(''))
    expect(reply.content.length).toBeGreaterThan(0)
    expect(events).not.toContain('thought_chunk')
    expect(events.filter((t) => t === 'tool_call')).toHaveLength(3)
    expect(events.filter((t) => t === 'message_chunk')).toHaveLength(reply.chunks.length)
    expect(events.filter((t) => t === 'usage_update')).toHaveLength(1)
  })

  it('forwards thought chunks only when streamThoughts is on', async () => {
    const events: string[] = []
    await driveRecordedFlow({ onEvent: (e) => events.push(e.type), streamThoughts: true })
    // The trimmed recording keeps two representative thought chunks.
    expect(events.filter((t) => t === 'thought_chunk')).toHaveLength(2)
  })

  it('collects toolCalls even without an onEvent callback', async () => {
    const reply = await driveRecordedFlow()
    expect(reply.toolCalls).toHaveLength(9)
  })
})
