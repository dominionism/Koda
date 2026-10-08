/**
 * Extracts executable shell commands from plain-text LLM responses.
 *
 * Handles:
 * - Fenced code blocks (```bash, ```sh, bare ```)
 * - Lines prefixed with $ or >
 * - Inline backtick commands in imperative context (e.g., Run `cmd`)
 */

/** Regex matching fenced code blocks with optional language tag. */
const FENCED_BLOCK_RE = /```(?:bash|sh|shell|zsh)?\s*\n([\s\S]*?)```/g;

/** Regex matching $-prefixed shell command lines. */
const DOLLAR_LINE_RE = /^\s*\$\s+(.+)$/;

/** Regex matching >-prefixed shell command lines. */
const CHEVRON_LINE_RE = /^\s*>\s+(.+)$/;

/** Regex matching inline backtick commands after imperative verbs. */
const INLINE_BACKTICK_RE = /(?:run|execute|use|try|enter|type)\s+`([^`]+)`/gi;
/**
 * Extract shell commands from LLM-generated text.
 *
 * @param text - Raw LLM output potentially containing shell commands.
 * @returns Deduplicated array of extracted command strings, trimmed and
 *   with leading $ stripped. Returns empty array for falsy/blank input.
 *
 * @behavior Scans for commands in three passes: (1) fenced code blocks,
 *   (2) $-prefixed and >-prefixed lines outside fenced blocks,
 *   (3) inline backtick commands preceded by imperative verbs.
 *   Uses a Set to deduplicate so the same command is not returned twice.
 */
export function extractCommands(text: string): string[] {
  if (!text || !text.trim()) return [];

  const commands: string[] = [];
  const seen = new Set<string>();

  function add(cmd: string) {
    const trimmed = cmd.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      commands.push(trimmed);
    }
  }

  // 1. Fenced code blocks
  let match: RegExpExecArray | null;
  while ((match = FENCED_BLOCK_RE.exec(text)) !== null) {
    const block = match[1];
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      // Strip leading $ if present inside fenced block
      const dollarMatch = trimmed.match(/^\$\s+(.+)/);
      add(dollarMatch ? dollarMatch[1] : trimmed);
    }
  }

  // 2. $-prefixed and >-prefixed lines (outside fenced blocks)
  const textWithoutFenced = text.replace(FENCED_BLOCK_RE, "");
  for (const line of textWithoutFenced.split("\n")) {
    const dollarMatch = line.match(DOLLAR_LINE_RE);
    if (dollarMatch) {
      add(dollarMatch[1]);
      continue;
    }
    const chevronMatch = line.match(CHEVRON_LINE_RE);
    if (chevronMatch) {
      add(chevronMatch[1]);
    }
  }

  // 3. Inline backtick commands in imperative context
  while ((match = INLINE_BACKTICK_RE.exec(textWithoutFenced)) !== null) {
    add(match[1]);
  }

  return commands;
}
