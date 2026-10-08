# Runtime Layer

## Overview

The Runtime Layer provides container-based environments where Koda coding agents run.

It is responsible for:

* Creating and managing workspaces
* Starting and stopping agent containers
* Connecting the Koda backend to coding agents through ACP

Each workspace has its own container and storage environment.

For deeper technical details, see:

* [Architecture](docs/architecture.md)
* [API Server](docs/api.md)
* [Security Model](docs/security.md)
* [ACP Communication](docs/acp.md)
* [Testing](docs/testing.md)

---

## Architecture

```text
                 Control

 Koda Backend ───────────────> Runtime Manager
                                  |
                                  |
                                  | Docker API
                                  |
                                  v


                 Data

 Koda Backend <──────── ACP ───── OpenCode
                                  |
                                  |
                                  v

                              /workspace
```

The Runtime Manager controls workspace lifecycle.

The backend uses the ACP connection created by the Runtime Manager to communicate with the coding agent.

---

## Directory Structure

```text
runtime/
├── src/
│   ├── types.ts              # Workspace, Runtime interface, errors
│   ├── docker-client.ts      # Dockerode wrapper with error handling
│   ├── workspace-manager.ts  # Runtime implementation
│   ├── acp-client.ts         # High-level ACP protocol client
│   ├── server.ts             # Hono HTTP routes + auth middleware
│   ├── server-entry.ts       # Entry point (serves on PORT, default 3100)
│   └── index.ts              # Barrel exports
├── tests/
│   ├── docker-client.test.ts
│   ├── workspace-manager.test.ts
│   ├── acp-client.test.ts
│   ├── server.test.ts
│   └── fixtures/             # ACP protocol replay fixtures
├── docs/
│   ├── architecture.md    # System design and components
│   ├── api.md             # HTTP API server reference
│   ├── security.md        # Isolation model and threat model
│   ├── acp.md             # ACP communication details
│   └── testing.md         # End-to-end testing walkthrough
├── image/
│   ├── Dockerfile         # Ubuntu 24.04 + Node.js + Python + OpenCode
│   ├── install.sh         # System dependencies installer
│   └── entrypoint.sh      # Helper script for ACP startup
├── package.json           # @koda/runtime, ESM
├── tsconfig.json
└── README.md
```

---

## Requirements

You need:

* Docker Engine
* Node.js LTS
* Permission to access the Docker daemon

---

## Quick Start

### Build the runtime image

```bash
docker build -t koda-runtime image/
```

### Create a workspace

```typescript
import { DockerClient, WorkspaceManager } from '@koda/runtime'

const client = new DockerClient()
const runtime = new WorkspaceManager(client)

const workspace = await runtime.createWorkspace({
  userId: 'user-123',
  env: { GROQ_API_KEY: process.env.GROQ_API_KEY! }
})
```

### Connect and talk to the agent

```typescript
import { AcpClient } from '@koda/runtime'

const { stdin, stdout } = await runtime.connectACP(workspace.id)
const acp = new AcpClient(stdin, stdout)

await acp.connect()
const session = await acp.newSession()
const reply = await acp.prompt(session.id, 'What is 2+2?')

console.log(reply.content) // "4"

acp.close()
```

`AcpClient` handles the ACP nd-JSON protocol (initialize, session/prompt with streaming chunks) so you work with simple async methods instead of raw JSON-RPC.

### Remove a workspace

```typescript
await runtime.destroyWorkspace(workspace.id)
```

---

## Workspace Lifecycle

A workspace follows this lifecycle:

```text
CREATED → RUNNING → STOPPED → DESTROYED
```

| Operation | Description                          |
| --------- | ------------------------------------ |
| Create    | Creates and starts a workspace       |
| Start     | Starts an existing stopped workspace |
| Stop      | Stops the container and keeps files  |
| Destroy   | Removes the workspace and its data   |

Stopping a workspace keeps user files.

Destroying a workspace permanently removes its data.

---

## Configuration

Workspace creation supports resource limits:

```typescript
{
  userId: string

  memoryLimit?: string
  cpuLimit?: number
  pidLimit?: number
  env?: Record<string, string>
}
```

Default limits:

| Resource  | Default |
| --------- | ------- |
| Memory    | 4 GB    |
| CPU       | 2 cores |
| Processes | 500     |

Example:

```typescript
await runtime.createWorkspace({
  userId: 'user-123',
  memoryLimit: '8g',
  cpuLimit: 4
})
```

---

## Debugging

View container logs:

```bash
docker logs <container-id>
```

Inspect a container:

```bash
docker inspect <container-id>
```

List containers:

```bash
docker ps
```

List managed workspaces:

```typescript
await runtime.listWorkspaces()
```

---

## Ownership

Changes affecting:

* Container permissions
* Networking
* Resource limits
* Workspace lifecycle
* ACP communication

... should be reviewed by the Runtime maintainers.
