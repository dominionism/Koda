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
  // Wipe root filesystem or recursive force-delete of any path
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/(?:\s|$)/i,
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\./i,
  // Format disks
  /\bmkfs\b/i,
  /\bnewfs\b/i,
  /\bdiskutil\s+eraseDisk\b/i,
  // dd to raw disk devices (macOS diskN, Linux sdX/hdX)
  /\bdd\s+.*of=\/dev\/(?:disk|rdisk)\d/i,
  /\bdd\s+.*of=\/dev\/[sh]d[a-z]/i,
  // Fork bombs
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  // Pipe untrusted remote scripts to shell
  /curl.*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
  /wget.*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
];

/**
 * Check whether a shell command is permitted by the safety policy.
 *
 * @behavior Blocks only catastrophic, irreversible commands that could destroy
 *   the system. Everything else is allowed — Koda is designed for full macOS
 *   access. The LLM itself provides an additional layer of judgment before
 *   executing risky operations.
 *
 * @param command - The shell command string to validate.
 * @returns true if the command is safe to execute; false if it matches a
 *   blocked command or pattern.
 */
export function isCommandSafe(command: string): boolean {
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
