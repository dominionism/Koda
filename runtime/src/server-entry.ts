import { serve } from '@hono/node-server'
import { DockerClient } from './docker-client.js'
import { WorkspaceManager } from './workspace-manager.js'
import { createApp } from './server.js'

const PORT = parseInt(process.env.PORT ?? '3100', 10)
const API_KEY = process.env.KODA_API_KEY

// Fail closed: an unset key must never silently mean "auth disabled".
if (!API_KEY && process.env.KODA_DEV_NO_AUTH !== '1') {
  console.error('[runtime-server] KODA_API_KEY is required. Set KODA_DEV_NO_AUTH=1 to run without auth in local development only.')
  process.exit(1)
}

const client = new DockerClient(process.env.DOCKER_SOCK)
const runtime = new WorkspaceManager(client)
const app = createApp(runtime, API_KEY)

// Rebuild the registry from labeled containers so a server restart does not
// orphan existing workspaces (and brick their users' create calls).
try {
  const recovered = await runtime.syncFromDocker()
  if (recovered > 0) console.log(`[runtime-server] recovered ${recovered} workspace(s) from Docker labels`)
} catch (err) {
  console.warn(`[runtime-server] could not sync workspaces from Docker: ${(err as Error).message}`)
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[runtime-server] listening on http://localhost:${info.port}`)
})
