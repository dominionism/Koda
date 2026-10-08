# HTTP API Server

## Overview

The Runtime Layer includes an HTTP server that exposes the Runtime interface over HTTP/JSON.

The server wraps the package's `Runtime` implementation (`WorkspaceManager`) and provides a REST API for workspace management.

---

## Setup

### Install dependencies

```bash
cd runtime
npm install
```

### Start the server

```bash
KODA_API_KEY=your-secret-key npx tsx src/server-entry.ts
```

The server starts on port 3100 by default.

Override with the `PORT` environment variable.

---

## Authentication

All routes require a Bearer token except `/health`.

```text
Authorization: Bearer <KODA_API_KEY>
```

When `KODA_API_KEY` is not set, authentication is disabled.

This is intended for local development only.

---

## Routes

### Health

```text
GET /health
```

No authentication required.

Response:

```json
{ "status": "ok" }
```

---

### Create workspace

```text
POST /workspaces
```

Request body:

```json
{
  "userId": "user-123",
  "agent": "omp",
  "memoryLimit": "4g",
  "cpuLimit": 2,
  "env": { "GROQ_API_KEY": "..." }
}
```

`agent` selects the coding agent the container boots: `"opencode"` (default)
or `"omp"`. It is an allowlist key, never a command — anything else is a
`400`. The choice is recorded in the `koda.agent` container label and
survives manager restarts.

OMP has no usable zero-config state: pin its model and providers by passing
`OMP_CONFIG_YML` / `OMP_MODELS_YML` in `env` (the image's `omp-launch` shim
writes them to `~/.omp/agent/*.yml` at boot — this is the BYOK provider
injection path; the user's API key rides inside `OMP_MODELS_YML`).
`OMP_ACP_ARGS` optionally appends flags to `omp acp` (e.g.
`--tools read,write,edit` to slim the tool prompt for low-TPM keys). See
`e2e/e2e.mjs` (`KODA_AGENT=omp`) for a working, live-proven configuration.

Response:

```json
201
{ "workspace": { "id": "...", "status": "running", "agent": "omp" } }
```

---

### List workspaces

```text
GET /workspaces
```

Response:

```json
200
{ "workspaces": [...] }
```

---

### Get workspace

```text
GET /workspaces/:id
```

Response:

```json
200
{ "workspace": { "id": "...", "status": "running" } }
```

Returns `404` if the workspace does not exist.

---

### Start workspace

```text
POST /workspaces/:id/start
```

Response:

```json
200
{ "status": "started" }
```

Returns `404` if the workspace does not exist.

---

### Stop workspace

```text
POST /workspaces/:id/stop
```

Response:

```json
200
{ "status": "stopped" }
```

Returns `404` if the workspace does not exist.

---

### Destroy workspace

```text
DELETE /workspaces/:id
```

Response:

```json
204
```

Returns `404` if the workspace does not exist.

---

### Prompt the agent (streaming)

```text
POST /workspaces/:id/prompt
```

The one seam that reaches the agent inside the box — callers (the voice
gateway) never touch Docker. The server opens ACP to the workspace
(`initialize` → `authenticate` → `session/new`), runs the prompt, and
**streams the agent's events back as newline-delimited JSON** (one event per
line, `Content-Type: application/x-ndjson`).

Request body:

```json
{ "text": "create a file hello.txt with hello world in it" }
```

Each streamed line is one event. The tool-call shapes are the #188 surface,
passed through verbatim from the observed OpenCode wire:

```jsonl
{"type":"thought_chunk","text":"I'll create the file."}
{"type":"tool_call","id":"t1","title":"write","kind":"edit","status":"pending"}
{"type":"tool_call_update","id":"t1","title":"workspace/hello.txt","kind":"edit","status":"completed"}
{"type":"message_chunk","text":"Done — created hello.txt."}
{"type":"result","content":"Done — created hello.txt.","stopReason":"end_turn"}
```

The stream always ends with exactly one terminal line: `{"type":"result",
content, stopReason}` on success, or `{"type":"error", message}` if the turn
died mid-stream. Events are flushed as they arrive (a `tool_call` line reaches
the client before `result`) so the caller can narrate in real time.

- `400` — `text` missing or empty.
- `404` — workspace not found.
- `409` — a prompt is already in flight for this workspace (one prompt per box).
- `401` — missing/invalid bearer.

A handshake failure before streaming begins returns a plain JSON error
(`404`/`500`); once streaming has begun, failures arrive as the terminal
`error` line.

---

## Error Responses

All error responses follow the same shape:

```json
{ "error": "message" }
```

Common status codes:

| Code | Meaning |
| ---- | ------- |
| 400  | Missing required fields (e.g. `userId`) |
| 401  | Invalid or missing Bearer token |
| 404  | Workspace not found |
| 500  | Internal server error |

---

## Testing

Unit tests:

```bash
cd runtime && npm test
```

Unit tests use a mock `Runtime` implementation and do not require Docker.

For full end-to-end testing against a live Docker daemon, see [Testing](testing.md).
