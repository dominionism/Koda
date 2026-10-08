import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DockerClient } from '../src/docker-client.js'
import Dockerode from 'dockerode'

// Shared mock container — persists across all tests, cleared in beforeEach
const mockContainer = {
  inspect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  attach: vi.fn(),
}

// Shared mock docker instance — returned by every Dockerode constructor call
const mockDockerInstance = {
  createContainer: vi.fn(),
  getContainer: vi.fn().mockReturnValue(mockContainer),
  listContainers: vi.fn(),
}

// Mock Dockerode: every `new Dockerode(...)` returns the shared mock instance
vi.mock('dockerode', () => ({
  default: vi.fn().mockImplementation(() => mockDockerInstance),
}))

// Helper to create a Dockerode-style error with statusCode
function dockerError(statusCode: number, message?: string): Error & { statusCode: number } {
  const err = new Error(message ?? `HTTP ${statusCode}`) as Error & { statusCode: number }
  err.statusCode = statusCode
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  // Restore getContainer to return the shared mockContainer after clearAllMocks
  mockDockerInstance.getContainer.mockReturnValue(mockContainer)
})

describe('DockerClient', () => {
  describe('createContainer', () => {
    it('returns inspect info on success', async () => {
      const info = { Id: 'abc123def456', Name: '/test-container' }
      mockDockerInstance.createContainer.mockResolvedValue({ inspect: vi.fn().mockResolvedValue(info) })

      const client = new DockerClient()
      const result = await client.createContainer({ Image: 'test' })

      expect(result).toEqual(info)
    })

    it('wraps Dockerode errors into meaningful messages', async () => {
      mockDockerInstance.createContainer.mockRejectedValue(new Error('No space left on device'))

      const client = new DockerClient()
      await expect(client.createContainer({ Image: 'test' })).rejects.toThrow(
        'Failed to create container: No space left on device',
      )
    })
  })

  describe('startContainer', () => {
    it('wraps errors into meaningful messages', async () => {
      mockContainer.start.mockRejectedValue(new Error('container not running'))

      const client = new DockerClient()
      await expect(client.startContainer('abc123')).rejects.toThrow(
        'Failed to start container abc123: container not running',
      )
    })
  })

  describe('stopContainer', () => {
    it('handles 304 (already stopped) gracefully', async () => {
      mockContainer.stop.mockRejectedValue(dockerError(304, 'HTTP 304'))

      const client = new DockerClient()
      // Should not throw
      await expect(client.stopContainer('abc123')).resolves.toBeUndefined()
    })

    it('wraps non-304 errors into meaningful messages', async () => {
      mockContainer.stop.mockRejectedValue(new Error('permission denied'))

      const client = new DockerClient()
      await expect(client.stopContainer('abc123')).rejects.toThrow(
        'Failed to stop container abc123: permission denied',
      )
    })
  })

  describe('removeContainer', () => {
    it('handles 404 (already removed) gracefully', async () => {
      mockContainer.remove.mockRejectedValue(dockerError(404, 'HTTP 404'))

      const client = new DockerClient()
      // Should not throw
      await expect(client.removeContainer('abc123')).resolves.toBeUndefined()
    })

    it('wraps non-404 errors into meaningful messages', async () => {
      mockContainer.remove.mockRejectedValue(new Error('cannot remove'))

      const client = new DockerClient()
      await expect(client.removeContainer('abc123')).rejects.toThrow(
        'Failed to remove container abc123: cannot remove',
      )
    })
  })

  describe('listContainers', () => {
    it('passes name filter to Dockerode', async () => {
      mockDockerInstance.listContainers.mockResolvedValue([])

      const client = new DockerClient()
      await client.listContainers('koda-user1')

      expect(mockDockerInstance.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { name: ['koda-user1'] },
      })
    })

    it('passes empty filters when no name filter given', async () => {
      mockDockerInstance.listContainers.mockResolvedValue([])

      const client = new DockerClient()
      await client.listContainers()

      expect(mockDockerInstance.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: {},
      })
    })

    it('wraps errors into meaningful messages', async () => {
      mockDockerInstance.listContainers.mockRejectedValue(new Error('daemon not running'))

      const client = new DockerClient()
      await expect(client.listContainers()).rejects.toThrow(
        'Failed to list containers: daemon not running',
      )
    })
  })

  describe('inspectContainer', () => {
    it('wraps errors into meaningful messages', async () => {
      mockContainer.inspect.mockRejectedValue(new Error('no such container'))

      const client = new DockerClient()
      await expect(client.inspectContainer('abc123')).rejects.toThrow(
        'Failed to inspect container abc123: no such container',
      )
    })
  })

  describe('formatError (via error messages)', () => {
    it('includes statusCode when present on error', async () => {
      mockContainer.inspect.mockRejectedValue(dockerError(404, 'Not Found'))

      const client = new DockerClient()
      await expect(client.inspectContainer('abc123')).rejects.toThrow(
        'Failed to inspect container abc123: Not Found (code=404)',
      )
    })

    it('omits statusCode when not present on error', async () => {
      mockContainer.inspect.mockRejectedValue(new Error('plain error'))

      const client = new DockerClient()
      await expect(client.inspectContainer('abc123')).rejects.toThrow(
        'Failed to inspect container abc123: plain error',
      )
    })
  })

  describe('removeContainer', () => {
    it('passes { force: true, v: true } for volume cleanup', async () => {
      mockContainer.remove.mockResolvedValue(undefined)

      const client = new DockerClient()
      await client.removeContainer('abc123', true)

      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true, v: true })
    })
  })
})
