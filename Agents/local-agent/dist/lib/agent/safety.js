// Safety policy: block only catastrophic, irreversible commands that could
// destroy the system.  Everything else is allowed — Koda is designed for
// full macOS access.  The LLM itself provides an additional layer of
// judgment before executing risky operations.
const BLOCKED_COMMANDS = [
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    ":(){:|:&};:",
];
const BLOCKED_PATTERNS = [
    // Wipe root filesystem
    /rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/(?:\s|$)/,
    // Format disks
    /\bmkfs\b/,
    /\bnewfs\b/,
    /\bdiskutil\s+eraseDisk\b/i,
    // dd to raw disk devices
    /\bdd\s+.*of=\/dev\/(?:disk|rdisk)\d/,
    // Fork bombs
    /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
    // Pipe untrusted remote scripts to shell
    /curl.*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/,
    /wget.*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/,
];
export function isCommandSafe(command) {
    const lower = command.toLowerCase();
    for (const blocked of BLOCKED_COMMANDS) {
        if (lower.includes(blocked.toLowerCase())) {
            return false;
        }
    }
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=safety.js.map