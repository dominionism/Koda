import "dotenv/config";
import { ChatOpenRouter } from "@langchain/openrouter";
import { MemorySaver } from "@langchain/langgraph";
export declare const memorySaver: MemorySaver;
export interface AgentConfig {
    modelName: string;
    apiKey: string;
    temperature?: number;
    maxTokens?: number;
}
export interface CreateAgentOptions {
    workingDirectory?: string;
    systemPrompt?: string;
}
export declare function createLLM(config: AgentConfig): ChatOpenRouter;
export declare function createAgent(config: AgentConfig, options?: CreateAgentOptions): Promise<any>;
export declare function getAgentConfig(): AgentConfig;
export declare function validateEnv(): void;
//# sourceMappingURL=config.d.ts.map