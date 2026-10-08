import http from "http";
import { executeWithAgent } from "./lib/agent/executor.js";
import { validateEnv } from "./lib/agent/config.js";
const PORT = parseInt(process.env.PORT ?? "3001", 10);
function isValidRequestBody(value) {
    if (!value || typeof value !== "object")
        return false;
    const request = value;
    return (typeof request.transcription === "string" &&
        request.transcription.trim() !== "" &&
        (request.workingDirectory === undefined || typeof request.workingDirectory === "string") &&
        (request.sessionId === undefined || typeof request.sessionId === "string"));
}
// Track in-flight requests by sessionId so /cancel can abort them.
const activeControllers = new Map();
async function handleRequest(req, signal) {
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
    // Cancel endpoint — aborts an in-flight agent invocation by sessionId.
    if (req.method === "POST" && req.url === "/cancel") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
            try {
                const { sessionId } = JSON.parse(body);
                const key = sessionId ?? "default";
                const ctrl = activeControllers.get(key);
                if (ctrl)
                    ctrl.abort();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            }
            catch {
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
        let parsed;
        try {
            parsed = JSON.parse(body);
        }
        catch {
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
            }
            finally {
                activeControllers.delete(sessionKey);
            }
        }
        catch (error) {
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
//# sourceMappingURL=index.js.map