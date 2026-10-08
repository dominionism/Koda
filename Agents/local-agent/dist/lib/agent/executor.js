import { getAgentConfig, createAgent, memorySaver } from "./config.js";
import { AGENT_TOTAL_TIMEOUT_MS } from "./constants.js";
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
function extractOutput(state) {
    const messages = (state.messages || []);
    if (messages.length === 0)
        return "";
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === "assistant" || msg.type === "ai") {
            const content = msg.content;
            if (typeof content === "string" && content.trim())
                return content;
            if (Array.isArray(content)) {
                const text = content
                    .filter((c) => c.type === "text")
                    .map((c) => c.text)
                    .join("\n");
                if (text.trim())
                    return text;
            }
        }
        if (msg.role === "tool" || msg.type === "tool") {
            const content = msg.content;
            if (typeof content === "string" && content.trim())
                return content;
        }
    }
    const last = messages[messages.length - 1];
    const content = last.content;
    return typeof content === "string" ? content : JSON.stringify(content);
}
function stringifyToolInput(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
    }
    if (value == null)
        return undefined;
    try {
        const serialized = JSON.stringify(value);
        return serialized === "{}" || serialized === "[]" ? undefined : serialized;
    }
    catch {
        return undefined;
    }
}
function extractToolActivity(state) {
    const messages = Array.isArray(state.messages) ? state.messages : [];
    const activity = [];
    for (const rawMessage of messages) {
        if (!rawMessage || typeof rawMessage !== "object")
            continue;
        const message = rawMessage;
        const toolCalls = Array.isArray(message.tool_calls)
            ? message.tool_calls
            : Array.isArray(message.toolCalls)
                ? message.toolCalls
                : [];
        for (const rawCall of toolCalls) {
            if (!rawCall || typeof rawCall !== "object")
                continue;
            const toolCall = rawCall;
            const tool = typeof toolCall.name === "string"
                ? toolCall.name.trim()
                : typeof toolCall.tool === "string"
                    ? toolCall.tool.trim()
                    : "";
            if (!tool)
                continue;
            const input = stringifyToolInput(toolCall.args
                ?? toolCall.input
                ?? toolCall.arguments
                ?? toolCall.arg);
            activity.push(input ? { tool, input } : { tool });
        }
    }
    return activity;
}
/** Trim the stored message history for a thread to at most MAX_HISTORY_MESSAGES. */
async function pruneThreadHistory(threadId) {
    const MAX_HISTORY_MESSAGES = 20;
    const config = { configurable: { thread_id: threadId } };
    const tuple = await memorySaver.getTuple(config);
    if (!tuple)
        return;
    const messages = tuple.checkpoint.channel_values.messages ?? [];
    if (messages.length <= MAX_HISTORY_MESSAGES)
        return;
    const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
    const newCheckpoint = {
        ...tuple.checkpoint,
        channel_values: { ...tuple.checkpoint.channel_values, messages: trimmed },
    };
    await memorySaver.put(config, newCheckpoint, tuple.metadata ?? { source: "update", step: -1, parents: {} });
}
export async function executeWithAgent(transcription, workingDirectory, sessionId, signal) {
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
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Agent timed out after ${AGENT_TOTAL_TIMEOUT_MS}ms`)), AGENT_TOTAL_TIMEOUT_MS));
        const result = await Promise.race([
            agent.invoke({ messages: [{ role: "user", content: transcription }] }, { configurable: { thread_id: threadId }, signal }),
            timeoutPromise,
        ]);
        const state = result;
        const output = extractOutput(state);
        const toolActivity = extractToolActivity(state);
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
    }
    catch (error) {
        return {
            success: false,
            output: "",
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
//# sourceMappingURL=executor.js.map