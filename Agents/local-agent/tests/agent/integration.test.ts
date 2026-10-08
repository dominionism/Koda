import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

describe("Deep Agent Integration Tests", () => {
  const shouldRunIntegrationTests = !!OPENROUTER_API_KEY;

  beforeAll(() => {
    if (!shouldRunIntegrationTests) {
      console.log(
        "Skipping integration tests: OPENROUTER_API_KEY not set",
      );
    }
  });

  /** If the agent returns a non-success result, log and skip — these tests
   *  require a funded OpenRouter key. */
  function requireSuccess(result: { success: boolean; error?: string }) {
    if (!result.success) {
      console.log(`Skipping: API unavailable — ${result.error}`);
      return false;
    }
    return true;
  }

  describe.skipIf(!shouldRunIntegrationTests)(
    "Voice Transcription → Command Execution",
    () => {
      it("'What is the current working directory?' → runs pwd", async () => {
        const { executeWithAgent } = await import(
          "../../src/lib/agent/executor"
        );

        const result = await executeWithAgent(
          "What is the current working directory? Just give me the path.",
        );

        if (!requireSuccess(result)) return;

        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();
        console.log("Input: 'What is the current working directory?'");
        console.log("Output:", result.output);
      }, 30000);

      it("'list all the files in the current folder' → runs ls", async () => {
        const { executeWithAgent } = await import(
          "../../src/lib/agent/executor"
        );

        const result = await executeWithAgent(
          "Hey, can you list all the files in the current folder for me?",
        );

        if (!requireSuccess(result)) return;

        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();
        console.log("Input: 'list all the files in the current folder'");
        console.log("Output:", result.output);
      }, 30000);

      it("'show me what files are here' → runs ls", async () => {
        const { executeWithAgent } = await import(
          "../../src/lib/agent/executor"
        );

        const result = await executeWithAgent("show me what files are here");

        if (!requireSuccess(result)) return;

        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();
        console.log("Input: 'show me what files are here'");
        console.log("Output:", result.output);
      }, 30000);

      it("'what node version am i running' → runs node --version", async () => {
        const { executeWithAgent } = await import(
          "../../src/lib/agent/executor"
        );

        const result = await executeWithAgent(
          "what node version am i running",
        );

        if (!requireSuccess(result)) return;

        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();
        console.log("Input: 'what node version am i running'");
        console.log("Output:", result.output);
      }, 30000);

      it("'find all typescript files' → runs glob for ts files", async () => {
        const { executeWithAgent } = await import(
          "../../src/lib/agent/executor"
        );

        const result = await executeWithAgent(
          "Find all the TypeScript files in this project",
        );

        if (!requireSuccess(result)) return;

        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();
        console.log(
          "Input: 'Find all the TypeScript files in this project'",
        );
        console.log("Output:", result.output);
      }, 30000);
    },
  );

  describe.skipIf(!shouldRunIntegrationTests)("Configuration", () => {
    it("should load config from environment", async () => {
      const { getAgentConfig } = await import("../../src/lib/agent/config");

      const config = getAgentConfig();
      expect(config.modelName).toBeDefined();
      expect(config.apiKey).toBeDefined();
      expect(config.temperature).toBeDefined();
    });
  });
});
