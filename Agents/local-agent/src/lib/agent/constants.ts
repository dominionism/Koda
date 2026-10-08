/**
 * Per-shell-command timeout in seconds, enforced by LocalShellBackend.
 *
 * @behavior Provides the upper bound (seconds) for individual shell command
 *   execution via LocalShellBackend. Does not throw; the backend enforces
 *   the timeout internally.
 */
export const SHELL_COMMAND_TIMEOUT_S = 30;

/**
 * Total Node.js agent budget in milliseconds.
 *
 * @behavior The LangGraph loop is raced against this deadline so Swift
 *   always receives an explicit error rather than a TCP reset. If the agent
 *   does not finish within this window, a timeout error is thrown.
 */
export const AGENT_TOTAL_TIMEOUT_MS = 50_000;

/**
 * Swift client request timeout in seconds.
 *
 * @behavior Must exceed AGENT_TOTAL_TIMEOUT_MS to give Node time to return
 *   an error rather than a TCP reset. Enforced in AgentClient.swift.
 */
export const SWIFT_CLIENT_TIMEOUT_S = 60;
