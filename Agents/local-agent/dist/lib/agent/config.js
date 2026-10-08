import "dotenv/config";
import { createDeepAgent, LocalShellBackend } from "deepagents";
import { ChatOpenRouter } from "@langchain/openrouter";
import { MemorySaver } from "@langchain/langgraph";
import { SimpleChatModel } from "@langchain/core/language_models/chat_models";
import { isCommandSafe } from "./safety.js";
// Singleton memory saver – persists conversation state across requests
// keyed by thread_id so each session maintains its own history.
export const memorySaver = new MemorySaver();
export function createLLM(config) {
    return new ChatOpenRouter({
        model: config.modelName,
        temperature: config.temperature ?? 0.7,
        apiKey: config.apiKey,
        maxTokens: config.maxTokens ?? 1024,
    });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createAgent(config, options) {
    // Create backend first so a mock LLM can directly call into it for
    // deterministic, offline testing.
    const rawBackend = await LocalShellBackend.create({
        rootDir: options?.workingDirectory ?? process.cwd(),
        inheritEnv: true,
        timeout: 300,
        maxOutputBytes: 500_000,
    });
    // Wrap the backend so the safety gate applies to all production tool calls,
    // not just mock/dev mode. All other backend methods delegate unchanged.
    const backend = new Proxy(rawBackend, {
        get(target, prop) {
            if (prop === "execute") {
                return async (cmd) => {
                    if (!isCommandSafe(cmd)) {
                        throw new Error(`Command blocked by safety policy: ${cmd}`);
                    }
                    return target.execute(cmd);
                };
            }
            const val = target[prop];
            return typeof val === "function" ? val.bind(target) : val;
        },
    });
    // If MOCK_LLM or DEV_MODE is enabled, return a simple deterministic
    // mock chat model that can simulate tool-calling by invoking the
    // backend directly. This lets us test execute/read/write tools without
    // calling external LLM providers.
    if (process.env.MOCK_LLM === "1" || process.env.DEV_MODE === "1") {
        // Implement a minimal chat model by extending SimpleChatModel so the
        // type system and deepagents accept it as a model instance.
        class MockChatModel extends SimpleChatModel {
            constructor() {
                super({});
            }
            // _call receives parsed messages (any) and should return a string
            // representing the model's response.
            async _call(messages) {
                const last = messages[messages.length - 1];
                const userText = typeof last?.content === "string" ? last.content : "";
                const execPrefix = "Execute this shell command and return the output:";
                let cmd = null;
                if (userText.includes(execPrefix)) {
                    cmd = userText.split(execPrefix)[1].trim();
                }
                else {
                    const m = userText.match(/(?:^|\b)(?:run:|run)\s+(.+)$/i);
                    if (m)
                        cmd = m[1].trim();
                }
                if (cmd) {
                    try {
                        const execResult = await backend.execute(cmd);
                        return String(execResult?.output ?? "");
                    }
                    catch (e) {
                        return `Error executing command: ${e instanceof Error ? e.message : String(e)}`;
                    }
                }
                return `MockLLM echo: ${userText}`;
            }
            _llmType() {
                return "mock";
            }
            _modelType() {
                return "mock-chat";
            }
        }
        return createDeepAgent({
            model: new MockChatModel(),
            backend,
            checkpointer: memorySaver,
            systemPrompt: options?.systemPrompt,
        });
    }
    const llm = createLLM(config);
    return createDeepAgent({
        model: llm,
        backend,
        checkpointer: memorySaver,
        systemPrompt: options?.systemPrompt,
    });
}
export function getAgentConfig() {
    // In MOCK_LLM / DEV_MODE, we allow missing OPENROUTER_API_KEY and return a
    // dummy apiKey since the mock model doesn't use it. In normal operation we
    // require the key.
    const apiKey = process.env.OPENROUTER_API_KEY ?? (process.env.MOCK_LLM === "1" || process.env.DEV_MODE === "1" ? "mock" : undefined);
    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY environment variable is required");
    }
    const modelName = process.env.LLM_MODEL;
    const temperature = process.env.LLM_TEMPERATURE;
    const maxTokens = process.env.LLM_MAX_TOKENS;
    return {
        modelName: modelName && modelName.trim() !== ""
            ? modelName
            : "anthropic/claude-sonnet-4",
        apiKey,
        temperature: temperature && temperature.trim() !== ""
            ? parseFloat(temperature)
            : 0.7,
        maxTokens: maxTokens && maxTokens.trim() !== ""
            ? parseInt(maxTokens, 10)
            : 1024,
    };
}
export function validateEnv() {
    if (process.env.MOCK_LLM === "1" || process.env.DEV_MODE === "1")
        return;
    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error("OPENROUTER_API_KEY environment variable is required");
    }
}
//# sourceMappingURL=config.js.map