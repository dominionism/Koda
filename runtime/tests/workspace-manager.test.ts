import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Duplex } from 'node:stream'
import { WorkspaceManager } from '../src/workspace-manager.js'
import type { DockerClient } from '../src/docker-client.js'
import type { Workspace } from '../src/types.js'

// Mock docker-client module
vi.mock('../src/docker-client.js')

function createMockClient(): DockerClient {
  return {
    createContainer: vi.fn().mockResolvedValue({
      Id: 'container-id-1234567890ab',
      Name: '/koda-testuser',
    }),
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    inspectContainer: vi.fn().mockResolvedValue({}),
    listContainers: vi.fn().mockResolvedValue([]),
    getContainer: vi.fn().mockReturnValue({
      attach: vi.fn().mockResolvedValue(
        new Duplex({
          read() { this.push(null) },
          write(_chunk, _enc, cb) { cb() },
        }),
      ),
      // connectACP demultiplexes the attach stream via the container's modem.
      modem: {
        demuxStream: vi.fn((stream: Duplex, out: NodeJS.WritableStream) => {
          stream.on('data', (d: Buffer) => out.write(d))
          stream.on('end', () => (out as { end?: () => void }).end?.())
        }),
      },
    }),
  } as unknown as DockerClient
}

describe('WorkspaceManager', () => {
  let client: DockerClient
  let manager: WorkspaceManager

  beforeEach(() => {
    client = createMockClient()
    manager = new WorkspaceManager(client)
  })

  describe('createWorkspace', () => {
    it('creates a container with correct security and stdio settings', async () => {
      const workspace = await manager.createWorkspace({ userId: 'user1' })

      expect(client.createContainer).toHaveBeenCalledOnce()
      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]

      expect(opts.Image).toBe('koda-runtime')
      expect(opts.Cmd).toEqual(['opencode', 'acp', '--cwd', '/workspace'])
      // opencode acp is a stdio server: stdin must stay open or it EOF-exits
      // at boot (observed live: Exited(0) ~2s after start, empty logs).
      expect(opts.OpenStdin).toBe(true)
      expect(opts.StdinOnce).toBe(false)
      expect(opts.Tty).toBe(false)
      expect(opts.HostConfig.Privileged).toBe(false)
      expect(opts.HostConfig.SecurityOpt).toEqual(['no-new-privileges'])
      // Bridge, never host: ACP rides stdio and the LLM call only needs
      // outbound — sharing the host's network namespace is pure liability.
      expect(opts.HostConfig.NetworkMode).toBe('bridge')
      // Default 4g = 4 * 1024^3 = 4294967296
      expect(opts.HostConfig.Memory).toBe(4 * 1024 ** 3)
      expect(opts.HostConfig.NanoCpus).toBe(2 * 1e9)
      expect(opts.HostConfig.PidsLimit).toBe(500)
      expect(workspace.status).toBe('running')
    })

    it('sanitizes userId in container and volume names', async () => {
      await manager.createWorkspace({ userId: 'user@domain.com' })

      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(opts.name).toBe('koda-f7ee5ec731216514')
      expect(opts.HostConfig.Binds).toEqual(['koda-ws-f7ee5ec731216514:/workspace'])
    })

    it('uses custom memory/cpu/pid limits when provided', async () => {
      await manager.createWorkspace({
        userId: 'user1',
        memoryLimit: '2g',
        cpuLimit: 4,
        pidLimit: 1000,
      })

      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(opts.HostConfig.Memory).toBe(2 * 1024 ** 3)
      expect(opts.HostConfig.NanoCpus).toBe(4 * 1e9)
      expect(opts.HostConfig.PidsLimit).toBe(1000)
    })

    it('rejects a second workspace for the same user with WorkspaceExistsError', async () => {
      const first = await manager.createWorkspace({ userId: 'user1' })

      await expect(manager.createWorkspace({ userId: 'user1' })).rejects.toThrow(
        `A workspace for user user1 already exists (${first.id})`,
      )
      // No second container was created.
      expect(client.createContainer).toHaveBeenCalledOnce()
    })

    it('allows retry after a failed (error-status) creation', async () => {
      (client.createContainer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Docker daemon error'),
      )
      await expect(manager.createWorkspace({ userId: 'user1' })).rejects.toThrow('Docker daemon error')

      // The errored entry must not block a retry — and must be replaced by it.
      const retried = await manager.createWorkspace({ userId: 'user1' })
      expect(retried.status).toBe('running')
      const all = await manager.listWorkspaces()
      expect(all).toHaveLength(1)
      expect(all[0].id).toBe(retried.id)
    })

    it('tracks workspace in-memory after creation', async () => {
      const workspace = await manager.createWorkspace({ userId: 'user1' })

      const retrieved = await manager.getWorkspace(workspace.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(workspace.id)
      expect(retrieved!.userId).toBe('user1')
    })

    it('sets status to error if Docker createContainer fails', async () => {
      (client.createContainer as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Docker daemon error'),
      )

      await expect(manager.createWorkspace({ userId: 'user1' })).rejects.toThrow('Docker daemon error')

      // The workspace should still be tracked but with error status
      const workspaces = await manager.listWorkspaces()
      expect(workspaces).toHaveLength(1)
      expect(workspaces[0].status).toBe('error')
    })

    it('sets container Labels for userId, workspaceId and agent', async () => {
      const workspace = await manager.createWorkspace({ userId: 'user1' })

      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(opts.Labels).toEqual({
        'koda.userId': 'user1',
        'koda.workspaceId': workspace.id,
        'koda.agent': 'opencode',
      })
    })

    it('defaults to the opencode agent', async () => {
      const workspace = await manager.createWorkspace({ userId: 'user1' })

      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(opts.Cmd).toEqual(['opencode', 'acp', '--cwd', '/workspace'])
      expect(workspace.agent).toBe('opencode')
    })

    it('boots omp when agent=omp is requested', async () => {
      const workspace = await manager.createWorkspace({ userId: 'user1', agent: 'omp' })

      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      // The image shim materializes OMP's config from env, then execs
      // `omp acp` (cwd comes from ACP session/new, not a flag).
      expect(opts.Cmd).toEqual(['omp-launch'])
      expect(opts.Labels['koda.agent']).toBe('omp')
      expect(workspace.agent).toBe('omp')
    })

    it('passes env vars to container as Env array', async () => {
      await manager.createWorkspace({
        userId: 'user1',
        env: { GROQ_API_KEY: 'test-key-value', NODE_ENV: 'production' },
      })

      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(opts.Env).toContain('GROQ_API_KEY=test-key-value')
      expect(opts.Env).toContain('NODE_ENV=production')
    })

    it('omits Env when no env vars provided', async () => {
      await manager.createWorkspace({ userId: 'user1' })

      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(opts.Env).toBeUndefined()
    })

    it('sets status to error if startContainer fails after create', async () => {
      (client.startContainer as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('start failed'),
      )

      await expect(manager.createWorkspace({ userId: 'user1' })).rejects.toThrow('start failed')

      const workspaces = await manager.listWorkspaces()
      expect(workspaces).toHaveLength(1)
      expect(workspaces[0].status).toBe('error')
    })
  })

  describe('startWorkspace', () => {
    it('starts a stopped workspace', async () => {
      const ws = await manager.createWorkspace({ userId: 'user1' })
      await manager.stopWorkspace(ws.id)

      expect(ws.status).toBe('stopped')

      await manager.startWorkspace(ws.id)
      expect(ws.status).toBe('running')
      expect(client.startContainer).toHaveBeenCalledWith(ws.containerId)
    })

    it('throws if workspace not found', async () => {
      await expect(manager.startWorkspace('nonexistent')).rejects.toThrow('Workspace nonexistent not found')
    })
  })

  describe('stopWorkspace', () => {
    it('stops a running workspace', async () => {
      const ws = await manager.createWorkspace({ userId: 'user1' })
      await manager.stopWorkspace(ws.id)

      expect(client.stopContainer).toHaveBeenCalledWith(ws.containerId, 10)
      expect(ws.status).toBe('stopped')
    })

    it('throws if workspace not found', async () => {
      await expect(manager.stopWorkspace('nonexistent')).rejects.toThrow('Workspace nonexistent not found')
    })
  })

  describe('destroyWorkspace', () => {
    it('stops and removes container, deletes from tracking', async () => {
      const ws = await manager.createWorkspace({ userId: 'user1' })

      await manager.destroyWorkspace(ws.id)

      expect(client.stopContainer).toHaveBeenCalledWith(ws.containerId, 10)
      expect(client.removeContainer).toHaveBeenCalledWith(ws.containerId, true)

      // Should no longer be tracked
      const retrieved = await manager.getWorkspace(ws.id)
      expect(retrieved).toBeNull()

      const workspaces = await manager.listWorkspaces()
      expect(workspaces).toHaveLength(0)
    })

    it('removes container even when stopContainer throws', async () => {
      const ws = await manager.createWorkspace({ userId: 'user1' });
      (client.stopContainer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('stop failed'))

      await manager.destroyWorkspace(ws.id)

      expect(client.stopContainer).toHaveBeenCalledWith(ws.containerId, 10)
      expect(client.removeContainer).toHaveBeenCalledWith(ws.containerId, true)

      const retrieved = await manager.getWorkspace(ws.id)
      expect(retrieved).toBeNull()
    })

    it('throws if workspace not found', async () => {
      await expect(manager.destroyWorkspace('nonexistent')).rejects.toThrow('Workspace nonexistent not found')
    })
  })

  describe('getWorkspace', () => {
    it('returns workspace by id', async () => {
      const ws = await manager.createWorkspace({ userId: 'user1' })
      const retrieved = await manager.getWorkspace(ws.id)
      expect(retrieved).toEqual(ws)
    })

    it('returns null for unknown id', async () => {
      const result = await manager.getWorkspace('unknown-id')
      expect(result).toBeNull()
    })
  })

  describe('getWorkspaceByUserId', () => {
    it('finds workspace by userId', async () => {
      const ws = await manager.createWorkspace({ userId: 'alice' })
      const found = await manager.getWorkspaceByUserId('alice')
      expect(found).not.toBeNull()
      expect(found!.id).toBe(ws.id)
    })

    it('returns null if no workspace exists for userId', async () => {
      const result = await manager.getWorkspaceByUserId('nobody')
      expect(result).toBeNull()
    })

    it('adopts a labeled container from Docker on registry miss', async () => {
      // koda-<sha256('alice')[:16]> — what a pre-restart manager would have made.
      const name = 'koda-2bd806c97f0e00af'
      ;(client.listContainers as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          Id: 'adopted-container-id',
          Names: [`/${name}`],
          State: 'running',
          Created: 1_752_800_000,
          Labels: { 'koda.userId': 'alice', 'koda.workspaceId': 'ws-restored-1' },
        },
      ])

      const found = await manager.getWorkspaceByUserId('alice')
      expect(found).not.toBeNull()
      expect(found!.id).toBe('ws-restored-1')
      expect(found!.containerId).toBe('adopted-container-id')
      expect(found!.status).toBe('running')
      // Pre-agent-label container: adoption defaults to opencode, the only
      // agent that existed when it was created.
      expect(found!.agent).toBe('opencode')

      // Adopted into the registry — a second lookup does not re-query Docker.
      ;(client.listContainers as ReturnType<typeof vi.fn>).mockClear()
      const again = await manager.getWorkspaceByUserId('alice')
      expect(again!.id).toBe('ws-restored-1')
      expect(client.listContainers).not.toHaveBeenCalled()
    })
  })

  describe('syncFromDocker', () => {
    it('rebuilds the registry from labeled containers', async () => {
      ;(client.listContainers as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          Id: 'c-1',
          Names: ['/koda-aaaa'],
          State: 'running',
          Created: 1_752_800_000,
          Labels: { 'koda.userId': 'alice', 'koda.workspaceId': 'ws-1' },
        },
        {
          Id: 'c-2',
          Names: ['/koda-bbbb'],
          State: 'exited',
          Created: 1_752_800_100,
          Labels: { 'koda.userId': 'bob', 'koda.workspaceId': 'ws-2' },
        },
        // An OMP workspace — the agent label must survive the round-trip.
        {
          Id: 'c-4',
          Names: ['/koda-cccc'],
          State: 'running',
          Created: 1_752_800_200,
          Labels: { 'koda.userId': 'carol', 'koda.workspaceId': 'ws-4', 'koda.agent': 'omp' },
        },
        // Unlabeled stranger on the koda- prefix — must be ignored.
        { Id: 'c-3', Names: ['/koda-rogue'], State: 'running', Labels: {} },
      ])

      const recovered = await manager.syncFromDocker()
      expect(recovered).toBe(3)

      const all = await manager.listWorkspaces()
      expect(all.map((w: Workspace) => w.id).sort()).toEqual(['ws-1', 'ws-2', 'ws-4'])
      expect((await manager.getWorkspace('ws-2'))!.status).toBe('stopped')
      // The agent label survives the round-trip; unlabeled = opencode default.
      expect((await manager.getWorkspace('ws-4'))!.agent).toBe('omp')
      expect((await manager.getWorkspace('ws-1'))!.agent).toBe('opencode')
    })

    it('is idempotent — already-tracked workspaces are not re-adopted', async () => {
      ;(client.listContainers as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          Id: 'c-1',
          Names: ['/koda-aaaa'],
          State: 'running',
          Labels: { 'koda.userId': 'alice', 'koda.workspaceId': 'ws-1' },
        },
      ])

      expect(await manager.syncFromDocker()).toBe(1)
      expect(await manager.syncFromDocker()).toBe(0)
      expect(await manager.listWorkspaces()).toHaveLength(1)
    })
  })

  describe('connectACP', () => {
    it('throws if workspace is not running', async () => {
      const ws = await manager.createWorkspace({ userId: 'user1' })
      await manager.stopWorkspace(ws.id)

      await expect(manager.connectACP(ws.id)).rejects.toThrow(
        `Workspace ${ws.id} is stopped (expected running)`,
      )
    })

    it('throws if workspace not found', async () => {
      await expect(manager.connectACP('nonexistent')).rejects.toThrow('Workspace nonexistent not found')
    })

    it('connects with a hijacked, demultiplexed attach', async () => {
      const ws = await manager.createWorkspace({ userId: 'user1' })
      const result = await manager.connectACP(ws.id)

      expect(result.stdin).toBeDefined()
      expect(result.stdout).toBeDefined()

      const container = (client.getContainer as ReturnType<typeof vi.fn>).mock.results[0].value
      // hijack is what lets stdin writes reach the container process.
      expect(container.attach).toHaveBeenCalledWith({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
      })
      // Tty is false, so the stream must be demultiplexed.
      expect(container.modem.demuxStream).toHaveBeenCalledOnce()
    })
  })

  describe('parseMemory (via createWorkspace)', () => {
    it('parses 512m correctly', async () => {
      await manager.createWorkspace({ userId: 'user1', memoryLimit: '512m' })
      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(opts.HostConfig.Memory).toBe(512 * 1024 ** 2)
    })

    it('parses 1t correctly', async () => {
      await manager.createWorkspace({ userId: 'user1', memoryLimit: '1t' })
      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(opts.HostConfig.Memory).toBe(1 * 1024 ** 4)
    })

    it('parses plain number as bytes', async () => {
      await manager.createWorkspace({ userId: 'user1', memoryLimit: '1024' })
      const opts = (client.createContainer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(opts.HostConfig.Memory).toBe(1024)
    })

    it('throws for 0g (zero is not positive)', async () => {
      await expect(
        manager.createWorkspace({ userId: 'user1', memoryLimit: '0g' }),
      ).rejects.toThrow('Memory limit must be positive: 0g')
    })
  })
})
