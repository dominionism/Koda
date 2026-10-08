import { getAgentConfig, createAgent } from "./config";
export async function parseTranscription(transcription) {
    const config = getAgentConfig();
    const agent = createAgent(config);
    const prompt = `You are a command parser. Convert this voice transcription into a shell command.

Voice transcription: "${transcription}"

Respond with ONLY valid JSON in this exact format:
{ "action": "command", "args": ["arg1", "arg2"], "originalText": "..." }

Examples:
- "list all files" → { "action": "ls", "args": ["-la"], "originalText": "list all files" }
- "show current directory" → { "action": "pwd", "args": [], "originalText": "show current directory" }
- "run npm build" → { "action": "npm", "args": ["run", "build"], "originalText": "run npm build" }

The action should be the shell command to execute. The args should be the arguments.`;
    const result = await agent.invoke([
        { role: "user", content: prompt },
    ]);
    const content = result.content;
    const parsed = JSON.parse(content);
    return {
        action: parsed.action,
        args: parsed.args,
        originalText: transcription,
    };
}
//# sourceMappingURL=command-parser.js.map