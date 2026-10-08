// End-to-end proof for the runtime layer, through the product path:
// DockerClient → WorkspaceManager.createWorkspace → connectACP → AcpClient.
//
// Requires: Docker daemon, the koda-runtime image built
// (`docker build -t koda-runtime image/`), and the manager compiled
// (`cd manager && npm install && npm run build`). Pass DOCKER_SOCK when the
// daemon is not at /var/run/docker.sock. An LLM key env (e.g. GROQ_API_KEY)
// is forwarded to the container; OpenCode may also use its free default model.
//
// Exit code 0 = the agent answered through the container. Anything else
// fails loudly — this script is the regression check for the stdin/attach/
// wire-shape class of bugs, which unit tests with mocked Docker cannot see.
import { DockerClient, WorkspaceManager, AcpClient } from '../dist/index.js'

const USER = `e2e-${Date.now()}`
const forwarded = {}
for (const key of ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY']) {
  if (process.env[key]) forwarded[key] = process.env[key]
}

const client = new DockerClient(process.env.DOCKER_SOCK)
const runtime = new WorkspaceManager(client)

const fail = (msg) => { console.error(`E2E FAIL — ${msg}`); process.exitCode = 1 }

let workspace
try {
  const agent = process.env.KODA_AGENT // undefined → manager default (opencode)
  if (agent === 'omp') {
    // OMP has no free default model: pin one via the image shim's env→file
    // materialization. The caps exist for free-tier Groq TPM (output
    // allowance counts toward the limit; trimmed tools shrink the prompt) —
    // proven live 2026-07-22 (fresh HOME, answer "4").
    if (!process.env.GROQ_API_KEY) {
      console.error('E2E FAIL — KODA_AGENT=omp requires GROQ_API_KEY')
      process.exit(1)
    }
    forwarded.OMP_CONFIG_YML = 'modelRoles:\n  default: groqcap/llama-3.3-70b-versatile'
    forwarded.OMP_MODELS_YML = [
      'providers:',
      '  groqcap:',
      '    baseUrl: https://api.groq.com/openai/v1',
      '    api: openai-completions',
      `    apiKey: ${process.env.GROQ_API_KEY}`,
      '    models:',
      '      - id: llama-3.3-70b-versatile',
      '        name: Llama 3.3 70B capped',
      '        contextWindow: 32000',
      '        maxTokens: 1500',
    ].join('\n')
    forwarded.OMP_ACP_ARGS = '--tools read,write,edit'
  }
  console.log(`[e2e] creating workspace for ${USER}${agent ? ` (agent: ${agent})` : ''}`)
  workspace = await runtime.createWorkspace({ userId: USER, env: forwarded, agent })

  // The container must survive its first seconds — the historical failure
  // mode was opencode EOF-exiting instantly on a closed stdin.
  await new Promise((r) => setTimeout(r, 3000))
  const info = await client.inspectContainer(workspace.containerId)
  if (!info.State?.Running) {
    fail(`container is not running 3s after start (status: ${info.State?.Status}, exit code: ${info.State?.ExitCode})`)
    process.exit(1)
  }
  console.log('[e2e] container alive after 3s')

  const { stdin, stdout } = await runtime.connectACP(workspace.id)
  const acp = new AcpClient(stdin, stdout, { promptTimeoutMs: 180_000 })

  const init = await acp.connect()
  console.log(`[e2e] initialize OK (agent: ${init.result?.agentInfo?.name} ${init.result?.agentInfo?.version})`)

  const methods = (init.result?.authMethods ?? []).map((m) => m.id)
  if (methods.includes('opencode-login')) {
    await acp.authenticate('opencode-login')
    console.log('[e2e] authenticate OK')
  }

  const session = await acp.newSession('/workspace')
  console.log(`[e2e] session/new OK (${session.id})`)

  const reply = await acp.prompt(session.id, 'What is 2+2? Reply with just the number.')
  console.log(`[e2e] session/prompt OK (stopReason: ${reply.stopReason}, chunks: ${reply.chunks.length})`)

  acp.close()

  // An upstream error narrated as a message chunk can contain a "4" (a 413
  // once produced a false PASS here) — reject error-shaped content first.
  if (/request too large|rate.?limit|api key|unauthorized|\berror\b/i.test(reply.content)) {
    fail(`the agent relayed an upstream error, not an answer: ${JSON.stringify(reply.content.slice(0, 200))}`)
  } else if (!reply.content.includes('4')) {
    fail(`expected the answer to contain "4", got: ${JSON.stringify(reply.content)}`)
  } else {
    console.log(`E2E PASS — content: ${JSON.stringify(reply.content.trim())}`)
  }
} catch (err) {
  fail(err.message)
} finally {
  if (workspace) {
    await runtime.destroyWorkspace(workspace.id).catch((e) => console.warn(`[e2e] cleanup: ${e.message}`))
  }
  process.exit(process.exitCode ?? 0)
}
