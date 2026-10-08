# Runtime Architecture

## Overview

The Runtime Layer provides the execution environment for Koda coding agents.

It sits between the Koda backend and the containers where agents run.

The system has two main responsibilities:

1. Manage workspace infrastructure.
2. Provide communication between the backend and coding agents.

---

## System Design

The runtime has two communication paths.

### Control Plane

The backend communicates with the Runtime Manager to manage workspaces.

Examples:

* Create workspace
* Start workspace
* Stop workspace
* Destroy workspace
* Open ACP connection

```text
Koda Backend
      |
      |
      v
Runtime Manager
      |
      |
      v
Docker API
```

---

### Data Plane

The backend communicates with the coding agent through ACP.

The Runtime Manager creates this connection, but does not handle agent messages.

```text
Koda Backend
      |
      |
      v
ACP Connection
      |
      |
      v
OpenCode ACP Server
```

---

## Components

### Runtime Manager

The Runtime Manager is the main runtime API.

It handles:

* Workspace lifecycle
* Docker container management
* Workspace metadata
* ACP connection setup

It communicates with Docker using the Docker API.

---

### Runtime Container

Each workspace runs inside its own container.

The container includes:

* Node.js
* Python
* OpenCode
* Required system dependencies

The user workspace is mounted at:

```text
/workspace
```

---

### Workspace Storage

Each workspace has its own Docker volume.

Example:

```text
koda-ws-user123
```

mounted as:

```text
/workspace
```

Workspace files remain available when a container is stopped.

Workspace files are removed when the workspace is destroyed.

---

## Agent Lifecycle

Each container starts OpenCode immediately when launched.

```bash
opencode acp --cwd /workspace
```

The ACP server runs as the container's main process for its lifetime.

The Runtime Manager attaches to the container's stdin/stdout to communicate.

---

## Repository Structure

```text
runtime/

├── image/
│   ├── Dockerfile
│   └── install.sh
│
├── src/
│   ├── types.ts
│   ├── docker-client.ts
│   ├── workspace-manager.ts
│   ├── acp-client.ts
│   ├── server.ts
│   ├── server-entry.ts
│   └── index.ts
│
├── tests/
│   └── fixtures/          # captured OpenCode ACP wire transcripts
│
├── e2e/
│   └── e2e.mjs            # live end-to-end proof against Docker
│
├── package.json
└── tsconfig.json
```

---

## Future Improvements

Possible future improvements:

* Stronger network isolation
* Additional sandboxing layers
* More advanced resource scheduling
* Improved workspace lifecycle management
