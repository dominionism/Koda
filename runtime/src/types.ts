/**
 * Workspace and runtime types for the Koda runtime manager.
 */

/** Lifecycle status of a user workspace. */
export type WorkspaceStatus = 'creating' | 'running' | 'stopped' | 'error'

/**
 * Coding agents installed in the runtime image, selectable per workspace.
 * The HTTP API only ever accepts one of these keys — the command line each
 * maps to lives in the manager's allowlist and never crosses the wire.
 */
export type AgentKind = 'opencode' | 'omp'

/** A managed workspace tied to a single user. */
export interface Workspace {
  /** Unique workspace identifier. */
  id: string
  /** The user who owns this workspace. */
  userId: string
  /** Docker container ID. */
  containerId: string
  /** Docker container name (e.g. koda-{userId}). */
  containerName: string
  /** Current lifecycle status. */
  status: WorkspaceStatus
  /** The coding agent this workspace's container runs. */
  agent: AgentKind
  /** When the workspace was created. */
  createdAt: Date
}

/** Configuration for creating a new workspace. */
export interface WorkspaceConfig {
  /** User ID that will own the workspace. */
  userId: string
  /** Container memory limit (default: '4g'). */
  memoryLimit?: string
  /** CPU limit in cores (default: 2). */
  cpuLimit?: number
  /** PID limit (default: 500). */
  pidLimit?: number
  /** Environment variables passed to the container (e.g. API keys). */
  env?: Record<string, string>
  /** Coding agent to run (default: 'opencode'). */
  agent?: AgentKind
}

/** Abstract contract for a workspace runtime. */
export interface Runtime {
  createWorkspace(config: WorkspaceConfig): Promise<Workspace>
  startWorkspace(id: string): Promise<void>
  stopWorkspace(id: string): Promise<void>
  destroyWorkspace(id: string): Promise<void>
  getWorkspace(id: string): Promise<Workspace | null>
  getWorkspaceByUserId(userId: string): Promise<Workspace | null>
  listWorkspaces(): Promise<Workspace[]>
  /** Rebuild the registry from labeled containers (call on process start). */
  syncFromDocker(): Promise<number>
  connectACP(id: string): Promise<{ stdin: WritableStream; stdout: ReadableStream }>
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a workspace ID is not found. */
export class WorkspaceNotFoundError extends Error {
  constructor(id: string) {
    super(`Workspace ${id} not found`)
    this.name = 'WorkspaceNotFoundError'
  }
}

/** Thrown when a workspace is not in the expected state for an operation. */
export class WorkspaceStateError extends Error {
  constructor(id: string, expected: string, actual: string) {
    super(`Workspace ${id} is ${actual} (expected ${expected})`)
    this.name = 'WorkspaceStateError'
  }
}

/** Thrown when creating a workspace for a user who already has one. */
export class WorkspaceExistsError extends Error {
  constructor(userId: string, workspaceId: string) {
    super(`A workspace for user ${userId} already exists (${workspaceId})`)
    this.name = 'WorkspaceExistsError'
  }
}
