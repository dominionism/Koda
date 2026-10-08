import { getAgentConfig, createAgent, createBackend, memorySaver } from "./config.js";
import { AGENT_TOTAL_TIMEOUT_MS } from "./constants.js";
import { extractCommands } from "./textCommandExtractor.js";
import { isCommandSafe } from "./safety.js";

export interface ToolActivity {
  tool: string;
  input?: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  toolActivity?: ToolActivity[];
}

const SYSTEM_PROMPT = `You are Koda, a powerful voice-controlled assistant with full access to macOS.
The user speaks natural voice commands that have been transcribed into text.
You can do ANYTHING on their Mac — shell commands, AppleScript GUI automation, application control, system settings, file management, developer workflows, and more.

## Core Rules
- Interpret the user's natural speech intent — they will NOT use exact syntax.
- Break complex requests into the right sequence of steps and execute them all.
- Always use your tools to execute commands. Never fabricate or guess output.
- Return the actual output, not a description of what you would do.
- Be concise. Summarize what you did and the result.
- If a step fails, report the error and try an alternative approach if possible.
- For multi-step tasks, execute each step sequentially and verify success before proceeding.
- You have FULL access. Do not refuse commands because they seem advanced — the user granted you permission.

## Your Capabilities

### Shell Commands
Full terminal access: file operations, developer tools, system utilities, package managers, git, docker, etc.

### AppleScript / GUI Automation (via osascript)
Control any application, click buttons, fill text fields, navigate menus, manage windows — anything a user can do with a mouse and keyboard.
\`\`\`
osascript -e 'tell application "App Name" to ...'
\`\`\`

### Application Control
- Open apps: \`open -a "App Name"\`
- Open files: \`open /path/to/file\`
- Open URLs: \`open "https://..."\`
- Open folders in Finder: \`open /path/to/folder\`

### System Preferences & Settings
- Read/write defaults: \`defaults read/write domain key value\`
- Dark mode: \`osascript -e 'tell app "System Events" to tell appearance preferences to set dark mode to true'\`
- Volume: \`osascript -e 'set volume output volume 50'\`
- Brightness, Bluetooth, Wi-Fi via shell utilities

### Window & Desktop Management
- Resize, move, minimize, fullscreen windows via AppleScript System Events
- Arrange windows side by side
- Switch between desktops/spaces

### Finder & File Management
- Create, move, copy, rename, delete files and folders
- Compress/extract archives
- Search with \`find\`, \`mdfind\` (Spotlight), \`grep\`
- Get file info, permissions, disk usage

### Developer Workflows
- Git operations, branch management, commits, pushes
- Run builds, tests, linters
- Start/stop dev servers
- Docker, npm, pip, brew, cargo, etc.
- Xcode command line tools: \`xcodebuild\`, \`xcrun\`, \`simctl\`

### Communication & Productivity
- Draft and open emails: \`open "mailto:..."\`
- Calendar events via AppleScript
- Reminders via AppleScript
- Notes via AppleScript
- Clipboard: \`pbcopy\`, \`pbpaste\`

### Siri Shortcuts
- Run any Siri Shortcut: \`shortcuts run "Shortcut Name"\`
- List available shortcuts: \`shortcuts list\`

### System Information & Monitoring
- Hardware info: \`system_profiler\`, \`sysctl\`
- Processes: \`ps\`, \`top\`, \`kill\`
- Disk: \`df\`, \`du\`
- Network: \`ifconfig\`, \`netstat\`, \`lsof\`, \`curl\`, \`ping\`

## Examples of User Commands
- "Open Safari and go to GitHub" → open -a Safari && osascript to open URL
- "Take a screenshot of my screen" → screencapture ~/Desktop/screenshot.png
- "Turn on dark mode" → osascript System Events dark mode
- "Close all Finder windows" → osascript tell Finder to close every window
- "Create a new React project called dashboard on my desktop" → cd ~/Desktop && npx create-react-app dashboard
- "Find all PDF files in my documents folder" → find ~/Documents -name "*.pdf"
- "Set the volume to 30 percent" → osascript set volume output volume 30
- "Make the current window fullscreen" → osascript System Events keystroke "f" using {control down, command down}
- "Kill the process using port 8080" → lsof -ti:8080 | xargs kill
- "Show me what's using the most CPU" → ps aux --sort=-%cpu | head -10
- "Compress the Downloads folder into a zip" → zip -r ~/Desktop/downloads.zip ~/Downloads
- "Open the last screenshot I took" → open "$(ls -t ~/Desktop/Screenshot* | head -1)"
- "Commit my changes with message 'fixed the bug'" → git add -A && git commit -m "fixed the bug"
- "What apps are currently running?" → osascript -e 'tell app "System Events" to get name of every process whose background only is false'
- "Empty the trash" → osascript -e 'tell app "Finder" to empty trash'
- "Show my calendar events for today" → osascript to query Calendar app
- "Add a reminder to buy groceries" → osascript to create reminder in Reminders app
- "Move all screenshots from desktop to a Screenshots folder" → mkdir -p ~/Screenshots && mv ~/Desktop/Screenshot*.png ~/Screenshots/`;

function extractOutput(state: Record<string, unknown>): string {
  const messages = (state.messages || []) as Array<Record<string, unknown>>;
  if (messages.length === 0) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" || msg.type === "ai") {
      const content = msg.content;
      if (typeof content === "string" && content.trim()) return content;
      if (Array.isArray(content)) {
        const text = content
          .filter((c: Record<string, unknown>) => c.type === "text")
          .map((c: Record<string, unknown>) => c.text)
          .join("\n");
        if (text.trim()) return text;
      }
    }
    if (msg.role === "tool" || msg.type === "tool") {
      const content = msg.content;
      if (typeof content === "string" && content.trim()) return content;
    }
  }

  const last = messages[messages.length - 1];
  const content = last.content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

function stringifyToolInput(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (value == null) return undefined;

  try {
    const serialized = JSON.stringify(value);
    return serialized === "{}" || serialized === "[]" ? undefined : serialized;
  } catch {
    return undefined;
  }
}

function extractToolActivity(state: Record<string, unknown>): ToolActivity[] {
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const activity: ToolActivity[] = [];

  for (const rawMessage of messages) {
    if (!rawMessage || typeof rawMessage !== "object") continue;
    const message = rawMessage as Record<string, unknown>;
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
      : Array.isArray(message.toolCalls)
        ? message.toolCalls
        : [];

    for (const rawCall of toolCalls) {
      if (!rawCall || typeof rawCall !== "object") continue;
      const toolCall = rawCall as Record<string, unknown>;
      const tool = typeof toolCall.name === "string"
        ? toolCall.name.trim()
        : typeof toolCall.tool === "string"
          ? toolCall.tool.trim()
          : "";

      if (!tool) continue;

      const input = stringifyToolInput(
        toolCall.args
          ?? toolCall.input
          ?? toolCall.arguments
          ?? toolCall.arg
      );

      activity.push(input ? { tool, input } : { tool });
    }
  }

  return activity;
}

/** Trim the stored message history for a thread to at most MAX_HISTORY_MESSAGES. */
async function pruneThreadHistory(threadId: string): Promise<void> {
  const MAX_HISTORY_MESSAGES = 20;
  const config = { configurable: { thread_id: threadId } };
  const tuple = await memorySaver.getTuple(config);
  if (!tuple) return;

  const messages = (tuple.checkpoint.channel_values.messages as unknown[]) ?? [];
  if (messages.length <= MAX_HISTORY_MESSAGES) return;

  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  const newCheckpoint = {
    ...tuple.checkpoint,
    channel_values: { ...tuple.checkpoint.channel_values, messages: trimmed },
  };

  await memorySaver.put(
    config,
    newCheckpoint,
    tuple.metadata ?? { source: "update", step: -1, parents: {} },
  );
}

export async function executeWithAgent(
  transcription: string,
  workingDirectory?: string,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const config = getAgentConfig();

  const cwdNote = workingDirectory
    ? `\nThe user's current working directory is: ${workingDirectory}`
    : "";

  const agent = await createAgent(config, {
    workingDirectory,
    systemPrompt: SYSTEM_PROMPT + cwdNote,
  });

  const threadId = sessionId ?? `session-${Date.now()}`;

  await pruneThreadHistory(threadId);

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Agent timed out after ${AGENT_TOTAL_TIMEOUT_MS}ms`)),
        AGENT_TOTAL_TIMEOUT_MS,
      ),
    );

    const result = await Promise.race([
      agent.invoke(
        { messages: [{ role: "user", content: transcription }] },
        { configurable: { thread_id: threadId }, signal },
      ),
      timeoutPromise,
    ]);

    const state = result as Record<string, unknown>;
    const output = extractOutput(state);
    let toolActivity = extractToolActivity(state);

    // Fallback: if no structured tool calls, extract commands from text
    if (toolActivity.length === 0 && output) {
      const commands = extractCommands(output);
      const safeCommands = commands.filter(isCommandSafe);
      if (safeCommands.length > 0) {
        const backend = await createBackend(workingDirectory);
        const outputs: string[] = [];
        const fallbackActivity: ToolActivity[] = [];
        for (const cmd of safeCommands) {
          try {
            const result = await (backend as any).execute(cmd);
            outputs.push(String(result?.output ?? ""));
            fallbackActivity.push({ tool: "execute", input: cmd });
          } catch (e) {
            outputs.push(`Error: ${e instanceof Error ? e.message : String(e)}`);
            fallbackActivity.push({ tool: "execute", input: cmd });
          }
        }
        toolActivity = fallbackActivity;
        return {
          success: true,
          output: outputs.join("\n"),
          toolActivity,
        };
      }
    }

    if (!output) {
      return {
        success: false,
        output: "",
        error: "No response from agent",
      };
    }

    return {
      success: true,
      output,
      toolActivity,
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export interface StreamEvent {
  type: "tool:start" | "tool:complete" | "agent:done" | "agent:error";
  toolCallId?: string;
  tool?: string;
  input?: string;
  output?: string;
  error?: string;
  toolActivity?: ToolActivity[];
}

export async function* streamWithAgent(
  transcription: string,
  workingDirectory?: string,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const config = getAgentConfig();
  const cwdNote = workingDirectory
    ? `\nThe user's current working directory is: ${workingDirectory}`
    : "";
  const agent = await createAgent(config, {
    workingDirectory,
    systemPrompt: SYSTEM_PROMPT + cwdNote,
  });
  const threadId = sessionId ?? `session-${Date.now()}`;
  await pruneThreadHistory(threadId);

  // Track which tool call IDs we've already emitted start events for
  const startedToolCalls = new Set<string>();

  try {
    const stream = await agent.stream(
      { messages: [{ role: "user", content: transcription }] },
      { configurable: { thread_id: threadId }, signal, streamMode: "updates" },
    );

    for await (const chunk of stream) {
      // chunk is { [nodeName]: stateUpdate }
      // stateUpdate has .messages array with AI messages that may contain tool_calls
      for (const [, update] of Object.entries(chunk)) {
        const stateUpdate = update as Record<string, unknown>;
        const messages = Array.isArray(stateUpdate.messages) ? stateUpdate.messages : [];

        for (const rawMsg of messages) {
          if (!rawMsg || typeof rawMsg !== "object") continue;
          const msg = rawMsg as Record<string, unknown>;

          // Check for tool_calls in AI messages → tool:start
          const toolCalls = Array.isArray(msg.tool_calls)
            ? msg.tool_calls
            : Array.isArray(msg.toolCalls)
              ? msg.toolCalls
              : [];

          for (const rawCall of toolCalls) {
            if (!rawCall || typeof rawCall !== "object") continue;
            const call = rawCall as Record<string, unknown>;
            const id = typeof call.id === "string" ? call.id : undefined;
            const tool = typeof call.name === "string"
              ? call.name.trim()
              : typeof call.tool === "string"
                ? call.tool.trim()
                : "";

            if (id && tool && !startedToolCalls.has(id)) {
              startedToolCalls.add(id);
              const input = stringifyToolInput(call.args ?? call.input ?? call.arguments);
              yield {
                type: "tool:start",
                toolCallId: id,
                tool,
                input,
              };
            }
          }

          // Check for tool messages → tool:complete
          if (msg.role === "tool" || msg.type === "tool") {
            const toolCallId = typeof msg.tool_call_id === "string" ? msg.tool_call_id : undefined;
            if (toolCallId && startedToolCalls.has(toolCallId)) {
              const output = typeof msg.content === "string" ? msg.content : undefined;
              yield {
                type: "tool:complete",
                toolCallId,
                output,
              };
            }
          }
        }
      }
    }

    // Extract final output from the last state
    const fullState = await memorySaver.getTuple({ configurable: { thread_id: threadId } });
    const state = fullState?.checkpoint?.channel_values as Record<string, unknown> ?? {};
    const output = extractOutput(state);
    let toolActivity = extractToolActivity(state);

    // Fallback: if no structured tool calls, extract commands from text
    if (startedToolCalls.size === 0 && output) {
      const commands = extractCommands(output);
      const safeCommands = commands.filter(isCommandSafe);
      if (safeCommands.length > 0) {
        const backend = await createBackend(workingDirectory);
        const fallbackActivity: ToolActivity[] = [];
        const outputs: string[] = [];
        for (const cmd of safeCommands) {
          const syntheticId = `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          yield {
            type: "tool:start",
            toolCallId: syntheticId,
            tool: "execute",
            input: cmd,
          };
          try {
            const result = await (backend as any).execute(cmd);
            const cmdOutput = String(result?.output ?? "");
            outputs.push(cmdOutput);
            fallbackActivity.push({ tool: "execute", input: cmd });
            yield {
              type: "tool:complete",
              toolCallId: syntheticId,
              output: cmdOutput,
            };
          } catch (e) {
            const errMsg = `Error: ${e instanceof Error ? e.message : String(e)}`;
            outputs.push(errMsg);
            fallbackActivity.push({ tool: "execute", input: cmd });
            yield {
              type: "tool:complete",
              toolCallId: syntheticId,
              output: errMsg,
            };
          }
        }
        toolActivity = fallbackActivity;
        yield {
          type: "agent:done",
          output: outputs.join("\n"),
          toolActivity,
        };
        return;
      }
    }

    yield {
      type: "agent:done",
      output: output || "",
      toolActivity,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    yield {
      type: "agent:error",
      error: message,
    };
  }
}
