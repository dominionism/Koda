import http from "http";
import { executeWithAgent, streamWithAgent } from "./lib/agent/executor.js";
import { validateEnv } from "./lib/agent/config.js";
import { AGENT_TOTAL_TIMEOUT_MS } from "./lib/agent/constants.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

interface Request {
  transcription: string;
  workingDirectory?: string;
  sessionId?: string;
}

interface ResponseData {
  result?: unknown;
  error?: string;
}

function isValidRequestBody(value: unknown): value is Request {
  if (!value || typeof value !== "object") return false;

  const request = value as Record<string, unknown>;
  return (
    typeof request.transcription === "string" &&
    request.transcription.trim() !== "" &&
    (request.workingDirectory === undefined || typeof request.workingDirectory === "string") &&
    (request.sessionId === undefined || typeof request.sessionId === "string")
  );
}

// Track in-flight requests by sessionId so /cancel can abort them.
const activeControllers = new Map<string, AbortController>();

async function handleRequest(req: Request, signal?: AbortSignal): Promise<ResponseData> {
  validateEnv();

  const { transcription, workingDirectory, sessionId } = req;

  if (!transcription || typeof transcription !== "string") {
    throw new Error("transcription is required and must be a string");
  }

  const result = await executeWithAgent(transcription, workingDirectory, sessionId, signal);

  return {
    result,
  };
}

const server = http.createServer(async (req, res) => {
  // Health check endpoint — used by AgentServerManager to verify readiness.
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // SSE streaming endpoint — emits tool activity events as the agent executes.
  if (req.method === "GET" && req.url?.startsWith("/stream")) {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const transcription = params.get("transcription");
    const workingDirectory = params.get("workingDirectory") ?? undefined;
    const sessionId = params.get("sessionId") ?? undefined;

    if (!transcription || !transcription.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "transcription query parameter is required" }));
      return;
    }

    validateEnv();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const sessionKey = sessionId ?? "default";
    const controller = new AbortController();
    const timeoutSignal = AbortSignal.timeout(AGENT_TOTAL_TIMEOUT_MS);
    const composedSignal = AbortSignal.any([controller.signal, timeoutSignal]);

    activeControllers.set(sessionKey, controller);

    // Abort agent if the client disconnects
    res.on("close", () => {
      controller.abort();
      activeControllers.delete(sessionKey);
    });

    (async () => {
      try {
        for await (const event of streamWithAgent(
          transcription,
          workingDirectory,
          sessionId,
          composedSignal,
        )) {
          if (res.writableEnded) break;
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (err) {
        if (!res.writableEnded) {
          const message = err instanceof Error ? err.message : "Unknown error";
          res.write(`data: ${JSON.stringify({ type: "agent:error", error: message })}\n\n`);
        }
      } finally {
        activeControllers.delete(sessionKey);
        if (!res.writableEnded) res.end();
      }
    })();
    return;
  }

  // Cancel endpoint — aborts an in-flight agent invocation by sessionId.
  if (req.method === "POST" && req.url === "/cancel") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { sessionId } = JSON.parse(body) as { sessionId?: string };
        const key = sessionId ?? "default";
        const ctrl = activeControllers.get(key);
        if (ctrl) ctrl.abort();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      }
    });
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    let parsed: unknown;

    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    if (!isValidRequestBody(parsed)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "transcription is required and must be a string" }));
      return;
    }

    try {
      const sessionKey = parsed.sessionId ?? "default";
      const controller = new AbortController();
      activeControllers.set(sessionKey, controller);
      try {
        const result = await handleRequest(parsed, controller.signal);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } finally {
        activeControllers.delete(sessionKey);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Agent server running on http://localhost:${PORT}`);
});

export { server, handleRequest };
