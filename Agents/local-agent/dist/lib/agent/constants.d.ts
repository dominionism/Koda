/** Per-shell-command timeout in seconds, enforced by LocalShellBackend. */
export declare const SHELL_COMMAND_TIMEOUT_S = 30;
/**
 * Total Node.js agent budget in milliseconds.
 * The LangGraph loop is raced against this deadline so Swift always receives
 * an explicit error rather than a TCP reset.
 */
export declare const AGENT_TOTAL_TIMEOUT_MS = 50000;
/**
 * Swift client request timeout in seconds.
 * Must exceed AGENT_TOTAL_TIMEOUT_MS to give Node time to return an error.
 * Enforced in AgentClient.swift.
 */
export declare const SWIFT_CLIENT_TIMEOUT_S = 60;
//# sourceMappingURL=constants.d.ts.map