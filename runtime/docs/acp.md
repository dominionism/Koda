# ACP Communication

## Overview

ACP is the protocol used by the backend to communicate with coding agents.

The Runtime Layer connects the Koda backend to OpenCode using ACP.

ACP messages use newline-delimited JSON (nd-JSON) over standard input and output streams.

Each message is a single JSON object followed by a newline.

---

## Connection Flow

1. The backend creates a workspace.

```typescript
const workspace = await runtime.createWorkspace({
  userId: 'user-123',
  env: { OPENROUTER_API_KEY: '...' }
})
```

2. The backend requests an ACP connection.

```typescript
const { stdin, stdout } = await runtime.connectACP(workspace.id)
```

3. The Runtime Manager attaches to the container's stdin/stdout.

4. The backend sends and receives nd-JSON messages through the streams.

---

## Protocol

ACP uses a request-response pattern over nd-JSON.

Messages sent to stdin are requests.

Messages received from stdout are responses or notifications.

---

### Initialize

Every session starts with an initialize request.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": { "name": "koda", "version": "0.1.0" },
    "clientCapabilities": {}
  }
}
```

The field is `clientCapabilities` — a `capabilities` field does not exist in
the protocol.

The server responds with its capabilities and advertised auth methods.

This must complete before any other messages are sent.

---

### Authenticate

OpenCode advertises the `opencode-login` auth method. Inside a runtime
container the provider credentials arrive as env vars, so this is a
handshake, not an interactive login.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "authenticate",
  "params": { "methodId": "opencode-login" }
}
```

---

### Create session

After initialization, create a session.

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/new",
  "params": {
    "cwd": "/workspace",
    "mcpServers": []
  }
}
```

`cwd` is **required** — omitting it returns
`-32602 Invalid params ("cwd: expected string, received undefined")`, even
when the process was started with `--cwd`. `mcpServers` must be an empty
array.

The server responds with a session ID.

---

### Send a prompt

Send user messages with `session/prompt`.

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "session/prompt",
  "params": {
    "sessionId": "<session-id>",
    "prompt": [{ "type": "text", "text": "What is 2+2?" }]
  }
}
```

The prompt is an **array of content blocks** — a `message` string field does
not exist in the protocol and returns
`-32602 Invalid params ("prompt: expected array, received undefined")`.

The final response carries `stopReason` and `usage` but **no text** — the
agent's words arrive only through the streaming `agent_message_chunk`
notifications below.

---

## Response Format

Responses are nd-JSON lines on stdout.

A complete response includes:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "stopReason": "end_turn",
    "usage": {
      "inputTokens": 34,
      "outputTokens": 4
    }
  }
}
```

`stopReason` indicates why the agent stopped:

| Value | Meaning |
| ----- | ------- |
| `end_turn` | Agent completed its response |
| `max_tokens` | Hit the output token limit |

---

## Streaming

The server may send intermediate updates before the final response.

These arrive as `session/update` notifications, with the payload nested
under `params.update` and discriminated by `sessionUpdate`:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "<session-id>",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": "The " }
    }
  }
}
```

Other observed `sessionUpdate` kinds include `agent_thought_chunk`,
`usage_update`, and `available_commands_update` — clients collect only
`agent_message_chunk` text into user-visible content.

Chunks are accumulated to build the full response; they are the **only**
carrier of the response text. The final response has the `stopReason` field.

---

## Container Setup

Containers run OpenCode as the main process.

```bash
opencode acp --cwd /workspace
```

The container needs:

* An LLM API key (passed via `env` in `WorkspaceConfig`), or OpenCode's
  free default model when available
* Optionally an `opencode.json` config in `/workspace` with model and
  provider settings

Example config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openrouter/free",
  "provider": { "openrouter": {} }
}
```

A missing API key does **not** make the server exit — the handshake
(initialize / session/new) still works and failures surface at prompt time.
An instant exit at container start means stdin is closed: `opencode acp` is
a stdio server and terminates on EOF, which is why the container must be
created with `OpenStdin: true`.

---

## Implementation Details

The Runtime Manager uses Docker attach to connect to the agent process.

```typescript
const duplex = await container.attach({
  stream: true,
  stdin: true,
  stdout: true,
  stderr: true,
  hijack: true,
})
container.modem.demuxStream(duplex, stdoutStream, stderrStream)
```

Two details are load-bearing:

* `hijack: true` is required for stdin — without it the returned stream is
  effectively read-only and writes never reach the process.
* With `Tty` disabled, Docker **always** multiplexes the attach stream with
  8-byte frame headers, regardless of which streams are attached — omitting
  `stderr` does not avoid it. `demuxStream` strips the framing and splits
  stderr out, so the ACP client sees clean nd-JSON and agent logs become
  log lines instead of protocol corruption.

The demultiplexed streams are converted to Web Streams using
`Readable.toWeb()` and `Writable.toWeb()`.

This avoids exposing additional network ports for agent communication.
