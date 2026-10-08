import Dockerode from 'dockerode'

/**
 * Wraps Dockerode with structured error handling.
 *
 * Container naming (`koda-{sha256(userId)[:16]}`) is owned by
 * WorkspaceManager — this class only talks to the Docker API.
 *
 * Socket resolution: explicit `socketPath` argument → a unix `DOCKER_HOST`
 * → `/var/run/docker.sock`. Without the env fallback, any non-Docker-Desktop
 * setup (colima, rootless, remote contexts) fails even when the `docker`
 * CLI works.
 */
export class DockerClient {
  private readonly docker: Dockerode

  constructor(socketPath?: string) {
    const envHost = process.env.DOCKER_HOST
    const envSocket = envHost?.startsWith('unix://') ? envHost.slice('unix://'.length) : undefined
    this.docker = new Dockerode({ socketPath: socketPath ?? envSocket ?? '/var/run/docker.sock' })
  }

  async createContainer(opts: Dockerode.ContainerCreateOptions): Promise<Dockerode.ContainerInspectInfo> {
    try {
      const container = await this.docker.createContainer(opts)
      const info = await container.inspect()
      console.log(`[docker] created container ${info.Name} (${info.Id.slice(0, 12)})`)
      return info
    } catch (err) {
      throw new Error(`Failed to create container: ${formatError(err)}`)
    }
  }

  async startContainer(id: string): Promise<void> {
    try {
      const container = this.docker.getContainer(id)
      await container.start()
      console.log(`[docker] started container ${id.slice(0, 12)}`)
    } catch (err) {
      throw new Error(`Failed to start container ${id.slice(0, 12)}: ${formatError(err)}`)
    }
  }

  async stopContainer(id: string, timeoutSec = 10): Promise<void> {
    try {
      const container = this.docker.getContainer(id)
      await container.stop({ t: timeoutSec })
      console.log(`[docker] stopped container ${id.slice(0, 12)}`)
    } catch (err: unknown) {
      // 304 = already stopped, not an error
      if (isStatusCode(err, 304)) {
        console.log(`[docker] container ${id.slice(0, 12)} already stopped`)
        return
      }
      throw new Error(`Failed to stop container ${id.slice(0, 12)}: ${formatError(err)}`)
    }
  }

  async removeContainer(id: string, force = true): Promise<void> {
    try {
      const container = this.docker.getContainer(id)
      await container.remove({ force, v: true })
      console.log(`[docker] removed container ${id.slice(0, 12)}`)
    } catch (err: unknown) {
      // 404 = already gone, not an error
      if (isStatusCode(err, 404)) {
        console.log(`[docker] container ${id.slice(0, 12)} already removed`)
        return
      }
      throw new Error(`Failed to remove container ${id.slice(0, 12)}: ${formatError(err)}`)
    }
  }

  async inspectContainer(id: string): Promise<Dockerode.ContainerInspectInfo> {
    try {
      const container = this.docker.getContainer(id)
      return await container.inspect()
    } catch (err) {
      throw new Error(`Failed to inspect container ${id.slice(0, 12)}: ${formatError(err)}`)
    }
  }

  async listContainers(nameFilter?: string): Promise<Dockerode.ContainerInfo[]> {
    try {
      const filters: Record<string, string[]> = {}
      if (nameFilter) {
        filters.name = [nameFilter]
      }
      return await this.docker.listContainers({ all: true, filters })
    } catch (err) {
      throw new Error(`Failed to list containers: ${formatError(err)}`)
    }
  }

  getContainer(id: string): Dockerode.Container {
    return this.docker.getContainer(id)
  }
}

// --- helpers ---

function formatError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const parts: string[] = []
    if (err instanceof Error) parts.push(err.message)
    if ('statusCode' in err) parts.push(`(code=${(err as { statusCode: number }).statusCode})`)
    return parts.join(' ') || String(err)
  }
  return String(err)
}

function isStatusCode(err: unknown, code: number): boolean {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    return (err as { statusCode: number }).statusCode === code
  }
  return false
}
