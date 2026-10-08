import { PassThrough, Readable, Writable } from 'node:stream'
import type { WritableStream, ReadableStream } from 'node:stream/web'
import { createHash, randomUUID } from 'node:crypto'
import { DockerClient } from './docker-client.js'
import type { AgentKind, Runtime, Workspace, WorkspaceConfig } from './types.js'
import { WorkspaceExistsError, WorkspaceNotFoundError, WorkspaceStateError } from './types.js'

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MEMORY_LIMIT = '4g'
const DEFAULT_CPU_LIMIT = 2
const DEFAULT_PID_LIMIT = 500
const STOP_GRACE_SECONDS = 10
const KODA_IMAGE = 'koda-runtime'
const KODA_PREFIX = 'koda'
const KODA_VOLUME_PREFIX = 'koda-ws'
const KODA_WORKSPACE_DIR = '/workspace'
const DEFAULT_AGENT: AgentKind = 'opencode'

// The command each installed agent boots as, keyed by the only values the
// HTTP API accepts — a command line never crosses the wire. OMP boots via
// its image shim (materializes ~/.omp/agent/*.yml from env — OMP has no env
// overrides for model/provider config) and takes its working directory from
// ACP `session/new` `cwd`, not a spawn flag.
const AGENT_COMMANDS: Record<AgentKind, string[]> = {
  opencode: ['opencode', 'acp', '--cwd', KODA_WORKSPACE_DIR],
  omp: ['omp-launch'],
}

// ---------------------------------------------------------------------------
// WorkspaceManager
// ---------------------------------------------------------------------------

/**
 * Manages isolated Docker workspaces — one per user.
 *
 * Implements the `Runtime` interface. Tracks workspaces in memory and
 * delegates all Docker operations to a `DockerClient`. Because container
 * names are deterministic per user, the in-memory registry can be rebuilt
 * from Docker labels after a restart via `syncFromDocker()`.
 */
export class WorkspaceManager implements Runtime {
  private readonly client: DockerClient
  private readonly workspaces = new Map<string, Workspace>()

  constructor(client: DockerClient) {
    this.client = client
  }

  // -------------------------------------------------------------------------
  // Runtime interface
  // -------------------------------------------------------------------------

  async createWorkspace(config: WorkspaceConfig): Promise<Workspace> {
    const { userId, memoryLimit = DEFAULT_MEMORY_LIMIT, cpuLimit = DEFAULT_CPU_LIMIT, pidLimit = DEFAULT_PID_LIMIT, env, agent = DEFAULT_AGENT } = config

    // Container names are deterministic per user, so a second create would
    // hit a Docker name conflict — surface it as a typed error instead.
    // A previous errored attempt is retryable: drop its stale entry.
    const existing = await this.getWorkspaceByUserId(userId)
    if (existing) {
      if (existing.status !== 'error') {
        throw new WorkspaceExistsError(userId, existing.id)
      }
      this.workspaces.delete(existing.id)
    }

    const id = randomUUID()
    const containerName = buildContainerName(userId)
    const volumeName = buildVolumeName(userId)

    console.log(`[workspace] creating workspace ${id} for user ${userId}`)

    // Track as creating immediately so concurrent lookups see the transition.
    const workspace: Workspace = {
      id,
      userId,
      containerId: '', // filled after Docker create
      containerName,
      status: 'creating',
      agent,
      createdAt: new Date(),
    }
    this.workspaces.set(id, workspace)

    try {
      const containerEnv = env
        ? Object.entries(env).map(([k, v]) => `${k}=${v}`)
        : undefined

      const info = await this.client.createContainer({
        Image: KODA_IMAGE,
        name: containerName,
        Env: containerEnv,
        // The main process is the agent's `acp` mode, a stdio JSON-RPC
        // server: its stdin must stay open or it reads EOF at boot and exits
        // (observed: Exited(0) ~2s after start, empty logs). Tty stays false
        // — the attach stream is demultiplexed in connectACP instead.
        OpenStdin: true,
        StdinOnce: false,
        Tty: false,
        HostConfig: {
          // Security
          Memory: parseMemory(memoryLimit),
          NanoCpus: cpuLimit * 1e9,
          PidsLimit: pidLimit,
          Privileged: false,
          SecurityOpt: ['no-new-privileges'],
          // Volumes
          Binds: [`${volumeName}:${KODA_WORKSPACE_DIR}`],
          // Networking — bridge gives outbound (LLM API) without sharing the
          // host's network namespace. ACP itself rides stdio, not the network.
          NetworkMode: 'bridge',
        },
        Cmd: AGENT_COMMANDS[agent],
        Labels: {
          'koda.userId': userId,
          'koda.workspaceId': id,
          'koda.agent': agent,
        },
      })

      workspace.containerId = info.Id

      await this.client.startContainer(info.Id)
      workspace.status = 'running'

      console.log(`[workspace] workspace ${id} running (${info.Id.slice(0, 12)})`)
      return workspace
    } catch (err) {
      workspace.status = 'error'
      console.error(`[workspace] failed to create workspace ${id}: ${(err as Error).message}`)
      throw err
    }
  }

  async startWorkspace(id: string): Promise<void> {
    const workspace = this.requireWorkspace(id)
    console.log(`[workspace] starting workspace ${id}`)
    await this.client.startContainer(workspace.containerId)
    workspace.status = 'running'
    console.log(`[workspace] workspace ${id} running`)
  }

  async stopWorkspace(id: string): Promise<void> {
    const workspace = this.requireWorkspace(id)
    console.log(`[workspace] stopping workspace ${id}`)
    await this.client.stopContainer(workspace.containerId, STOP_GRACE_SECONDS)
    workspace.status = 'stopped'
    console.log(`[workspace] workspace ${id} stopped`)
  }

  async destroyWorkspace(id: string): Promise<void> {
    const workspace = this.requireWorkspace(id)
    console.log(`[workspace] destroying workspace ${id}`)

    try {
      await this.client.stopContainer(workspace.containerId, STOP_GRACE_SECONDS)
    } catch (err) {
      console.warn(`[workspace] stop failed during destroy, proceeding with remove: ${(err as Error).message}`)
    }

    await this.client.removeContainer(workspace.containerId, true)
    workspace.status = 'stopped'
    this.workspaces.delete(id)
    console.log(`[workspace] workspace ${id} destroyed`)
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id) ?? null
  }

  async getWorkspaceByUserId(userId: string): Promise<Workspace | null> {
    const name = buildContainerName(userId)
    for (const ws of this.workspaces.values()) {
      if (ws.containerName === name) return ws
    }
    // Registry miss — the container may predate this process (manager
    // restart). Fall through to Docker and adopt it if found.
    const infos = await this.client.listContainers(name)
    for (const info of infos) {
      if (!(info.Names ?? []).some((n) => n === `/${name}`)) continue
      const adopted = this.adoptContainer(info)
      if (adopted) return adopted
    }
    return null
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return [...this.workspaces.values()]
  }

  /**
   * Rebuild the in-memory registry from labeled Koda containers.
   *
   * Call on process start: without it, a manager restart forgets every
   * container it made, and each returning user's create call collides with
   * their still-existing container name. Returns the number recovered.
   */
  async syncFromDocker(): Promise<number> {
    const infos = await this.client.listContainers(`${KODA_PREFIX}-`)
    let recovered = 0
    for (const info of infos) {
      if (this.adoptContainer(info, { onlyNew: true })) recovered++
    }
    return recovered
  }

  async connectACP(id: string): Promise<{ stdin: WritableStream; stdout: ReadableStream }> {
    const workspace = this.requireWorkspace(id)
    if (workspace.status !== 'running') {
      throw new WorkspaceStateError(id, 'running', workspace.status)
    }

    console.log(`[workspace] connecting ACP to workspace ${id}`)

    const container = this.client.getContainer(workspace.containerId)
    // hijack is required for writes to reach the container's stdin; without
    // it the returned stream is effectively read-only.
    const duplex = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    })

    // With Tty disabled, Docker multiplexes stdout/stderr on the attach
    // socket with 8-byte frame headers — always, regardless of which streams
    // are attached. Demultiplex so the ACP client sees clean nd-JSON, and
    // surface agent stderr as logs instead of corrupting the protocol.
    const stdoutNode = new PassThrough()
    const stderrNode = new PassThrough()
    ;(container as unknown as { modem: { demuxStream: (s: NodeJS.ReadableStream, o: NodeJS.WritableStream, e: NodeJS.WritableStream) => void } })
      .modem.demuxStream(duplex, stdoutNode, stderrNode)
    stderrNode.on('data', (chunk: Buffer) => {
      console.warn(`[workspace ${id}] agent stderr: ${chunk.toString().trimEnd().slice(0, 500)}`)
    })

    const stdin = Writable.toWeb(duplex as any) as WritableStream
    const stdout = Readable.toWeb(stdoutNode) as ReadableStream

    return { stdin, stdout }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireWorkspace(id: string): Workspace {
    const ws = this.workspaces.get(id)
    if (!ws) throw new WorkspaceNotFoundError(id)
    return ws
  }

  /** Adopt a labeled container into the registry (used by rediscovery). */
  private adoptContainer(
    info: { Id: string; Names?: string[]; State?: string; Created?: number; Labels?: Record<string, string> },
    opts: { onlyNew?: boolean } = {},
  ): Workspace | null {
    const userId = info.Labels?.['koda.userId']
    const workspaceId = info.Labels?.['koda.workspaceId']
    if (!userId || !workspaceId) return null
    if (this.workspaces.has(workspaceId)) {
      return opts.onlyNew ? null : this.workspaces.get(workspaceId)!
    }
    const workspace: Workspace = {
      id: workspaceId,
      userId,
      containerId: info.Id,
      containerName: (info.Names?.[0] ?? '').replace(/^\//, ''),
      status: info.State === 'running' ? 'running' : 'stopped',
      // Pre-agent-label containers default to opencode — the only agent that
      // existed when they were created.
      agent: (info.Labels?.['koda.agent'] as AgentKind | undefined) ?? DEFAULT_AGENT,
      createdAt: new Date((info.Created ?? 0) * 1000),
    }
    this.workspaces.set(workspaceId, workspace)
    console.log(`[workspace] adopted workspace ${workspaceId} for user ${userId} from Docker`)
    return workspace
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitise userId to a collision-safe container name fragment (first 16 hex chars of SHA-256). */
function sanitizeUserId(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 16)
}

function buildContainerName(userId: string): string {
  return `${KODA_PREFIX}-${sanitizeUserId(userId)}`
}

function buildVolumeName(userId: string): string {
  return `${KODA_VOLUME_PREFIX}-${sanitizeUserId(userId)}`
}

/** Parse a human-readable memory string (e.g. '4g') to bytes. */
function parseMemory(limit: string): number {
  const match = limit.match(/^(\d+(?:\.\d+)?)\s*(b|k|m|g|t)?$/i)
  if (!match) throw new Error(`Invalid memory limit: ${limit}`)
  const value = parseFloat(match[1])
  const unit = (match[2] ?? 'b').toLowerCase()
  const multipliers: Record<string, number> = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }
  const bytes = Math.floor(value * multipliers[unit])
  if (bytes <= 0) throw new Error(`Memory limit must be positive: ${limit}`)
  return bytes
}
