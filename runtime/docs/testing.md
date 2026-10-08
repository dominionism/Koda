# Testing

## Overview

End-to-end testing for the Runtime Layer requires Docker and an LLM API key.

This guide walks through building the image, running the server, and testing ACP communication.

---

## Prerequisites

* Docker Engine running
* Node.js LTS
* An LLM API key (OpenRouter, Groq, etc.)

---

## 1. Build the runtime image

```bash
cd runtime
docker build -t koda-runtime image/
```

---

## 2. Start the server

```bash
cd runtime
npm install
KODA_API_KEY=test-secret npx tsx src/server-entry.ts
```

The server listens on `http://localhost:3100`.

---

## 3. Create a workspace

```bash
curl -s -X POST http://localhost:3100/workspaces \
  -H "Authorization: Bearer test-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "env": { "OPENROUTER_API_KEY": "your-api-key" }
  }'
```

Response:

```json
{ "workspace": { "id": "<workspace-id>", "status": "running" } }
```

---

## 4. Check workspace status

```bash
curl -s http://localhost:3100/workspaces/<workspace-id> \
  -H "Authorization: Bearer test-secret"
```

---

## 5. Connect to ACP

The HTTP server manages workspace lifecycle but does not proxy ACP.

The repeatable end-to-end proof lives in the repo — it creates a workspace
through the real `WorkspaceManager`, attaches over the real Docker socket,
and drives real OpenCode through `AcpClient`:

```bash
cd runtime
npm install && npm run build
GROQ_API_KEY=your-key node e2e/e2e.mjs
```

Pass `DOCKER_SOCK=/path/to/docker.sock` when the daemon is not at
`/var/run/docker.sock` (colima: `~/.colima/default/docker.sock`).

Expected output ends with:

```text
E2E PASS — content: "4"
```

For manual protocol poking, the wire shapes are (see `docs/acp.md` for the
full reference — `cwd` and the `prompt` content-block array are required):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"cli","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/workspace","mcpServers":[]}}
{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"<from session/new>","prompt":[{"type":"text","text":"What is 2+2?"}]}}
```

---

## 6. Stop, start, destroy

```bash
# Stop
curl -s -X POST http://localhost:3100/workspaces/<id>/stop \
  -H "Authorization: Bearer test-secret"

# Start
curl -s -X POST http://localhost:3100/workspaces/<id>/start \
  -H "Authorization: Bearer test-secret"

# Destroy
curl -s -X DELETE http://localhost:3100/workspaces/<id> \
  -H "Authorization: Bearer test-secret"
```

---

## 7. Unit tests

```bash
cd runtime && npm test
```

Unit tests use a mock `Runtime` and do not require Docker.
