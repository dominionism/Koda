import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeWithAgent } from "../../src/lib/agent/executor";

const { mockGetAgentConfig, mockCreateAgent, mockInvoke, mockMemorySaverGetTuple, mockMemorySaverPut } = vi.hoisted(() => {
  return {
    mockGetAgentConfig: vi.fn(),
    mockCreateAgent: vi.fn(),
    mockInvoke: vi.fn(),
    mockMemorySaverGetTuple: vi.fn(),
    mockMemorySaverPut: vi.fn(),
  };
});

vi.mock("../../src/lib/agent/config", () => ({
  getAgentConfig: mockGetAgentConfig,
  createAgent: mockCreateAgent,
  memorySaver: {
    getTuple: mockMemorySaverGetTuple,
    put: mockMemorySaverPut,
  },
}));

describe("executor", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-api-key");
    vi.clearAllMocks();
    mockMemorySaverGetTuple.mockResolvedValue(null);

    mockGetAgentConfig.mockReturnValue({
      modelName: "anthropic/claude-sonnet-4",
      apiKey: "test-openrouter-api-key",
      temperature: 0.7,
      maxTokens: 1024,
    });

    // createAgent is now async — mock returns a Promise
    mockCreateAgent.mockResolvedValue({
      invoke: mockInvoke,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("executeWithAgent", () => {
    it("should execute transcription and return success result", async () => {
      mockInvoke.mockResolvedValue({
        messages: [
          { role: "user", content: "list all files" },
          {
            role: "assistant",
            content: "total 0\ndrwxr-xr-x  5 user  staff   160 Mar 27 10:00 .",
          },
        ],
      });

      const result = await executeWithAgent("list all files");
      expect(result.success).toBe(true);
      expect(result.output).toContain("total");
      expect(result.error).toBeUndefined();
    });

    it("should pass workingDirectory to createAgent options", async () => {
      mockInvoke.mockResolvedValue({
        messages: [{ role: "assistant", content: "done" }],
      });

      await executeWithAgent("list files", "/Users/test/project");

      expect(mockCreateAgent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workingDirectory: "/Users/test/project",
          systemPrompt: expect.stringContaining("/Users/test/project"),
        }),
      );
    });

    it("should pass sessionId as thread_id in invoke config", async () => {
      mockInvoke.mockResolvedValue({
        messages: [{ role: "assistant", content: "done" }],
      });

      await executeWithAgent("test", undefined, "my-session-123");

      expect(mockInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "test" }),
          ]),
        }),
        expect.objectContaining({
          configurable: { thread_id: "my-session-123" },
        }),
      );
    });

    it("should return failure result on error", async () => {
      mockInvoke.mockRejectedValue(new Error("Command failed"));

      const result = await executeWithAgent("run invalid command");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Command failed");
    });

    it("should handle unknown errors", async () => {
      mockInvoke.mockRejectedValue("Unknown error");

      const result = await executeWithAgent("test");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown error");
    });

    it("should return error when no messages in response", async () => {
      mockInvoke.mockResolvedValue({});

      const result = await executeWithAgent("test");
      expect(result.success).toBe(false);
      expect(result.error).toBe("No response from agent");
    });
  });

  describe("command-like transcriptions", () => {
    it("should execute shell-like input and return success result", async () => {
      mockInvoke.mockResolvedValue({
        messages: [
          { role: "user", content: "ls -la" },
          {
            role: "assistant",
            content: "total 0\ndrwxr-xr-x  5 user  staff   160 Mar 27 10:00 .",
          },
        ],
      });

      const result = await executeWithAgent("ls -la");
      expect(result.success).toBe(true);
      expect(result.output).toContain("total");
      expect(result.error).toBeUndefined();
    });

    it("should return failure result on error", async () => {
      mockInvoke.mockRejectedValue(new Error("Command failed"));

      const result = await executeWithAgent("invalid-command");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Command failed");
    });

    it("should pass command-like transcription to agent", async () => {
      mockInvoke.mockResolvedValue({
        messages: [
          { role: "user", content: "test" },
          { role: "assistant", content: "Build complete" },
        ],
      });

      await executeWithAgent("npm run build");

      expect(mockInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining("npm run build"),
            }),
          ]),
        }),
        expect.anything(),
      );
    });

    it("should handle unknown errors", async () => {
      mockInvoke.mockRejectedValue("Unknown error");

      const result = await executeWithAgent("test");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown error");
    });
  });
});
