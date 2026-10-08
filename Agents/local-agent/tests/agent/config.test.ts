import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAgentConfig, createAgent, validateEnv } from "../../src/lib/agent/config";

describe("config", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-api-key");
    vi.stubEnv("LLM_MODEL", "anthropic/claude-sonnet-4");
    vi.stubEnv("LLM_TEMPERATURE", "0.7");
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getAgentConfig", () => {
    it("should return config with API key from env", () => {
      const config = getAgentConfig();
      expect(config.apiKey).toBe("test-openrouter-api-key");
    });

    it("should use default model when not specified", () => {
      delete process.env.LLM_MODEL;
      const config = getAgentConfig();
      expect(config.modelName).toBe("anthropic/claude-sonnet-4");
    });

    it("should use custom model when specified", () => {
      vi.stubEnv("LLM_MODEL", "openai/gpt-4o");
      const config = getAgentConfig();
      expect(config.modelName).toBe("openai/gpt-4o");
    });

    it("should use default temperature when not specified", () => {
      delete process.env.LLM_TEMPERATURE;
      const config = getAgentConfig();
      expect(config.temperature).toBe(0.7);
    });

    it("should parse custom temperature", () => {
      vi.stubEnv("LLM_TEMPERATURE", "0.5");
      const config = getAgentConfig();
      expect(config.temperature).toBe(0.5);
    });

    it("should use default maxTokens when not specified", () => {
      delete process.env.LLM_MAX_TOKENS;
      const config = getAgentConfig();
      expect(config.maxTokens).toBe(1024);
    });

    it("should parse custom maxTokens", () => {
      vi.stubEnv("LLM_MAX_TOKENS", "2048");
      const config = getAgentConfig();
      expect(config.maxTokens).toBe(2048);
    });

    it("should throw error when API key is missing", () => {
      delete process.env.OPENROUTER_API_KEY;
      expect(() => getAgentConfig()).toThrow(
        "OPENROUTER_API_KEY environment variable is required"
      );
    });
  });

  describe("validateEnv", () => {
    it("should not throw when API key is present", () => {
      expect(() => validateEnv()).not.toThrow();
    });

    it("should throw when API key is missing", () => {
      delete process.env.OPENROUTER_API_KEY;
      expect(() => validateEnv()).toThrow(
        "OPENROUTER_API_KEY environment variable is required"
      );
    });
  });

  describe("createAgent", () => {
    it("should create agent with config", async () => {
      const config = {
        modelName: "anthropic/claude-sonnet-4",
        apiKey: "test-key",
        temperature: 0.7,
      };
      const agent = await createAgent(config);
      expect(agent).toBeDefined();
    });

    it("should accept workingDirectory and systemPrompt options", async () => {
      const config = {
        modelName: "anthropic/claude-sonnet-4",
        apiKey: "test-key",
        temperature: 0.7,
      };
      const agent = await createAgent(config, {
        workingDirectory: "/tmp",
        systemPrompt: "You are a test agent.",
      });
      expect(agent).toBeDefined();
    });
  });
});
