export class AgentError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'AgentError';
    }
}
export class CommandParseError extends AgentError {
    constructor(message) {
        super(message, 'PARSE_ERROR');
        this.name = 'CommandParseError';
    }
}
export class CommandExecutionError extends AgentError {
    constructor(message) {
        super(message, 'EXECUTION_ERROR');
        this.name = 'CommandExecutionError';
    }
}
//# sourceMappingURL=errors.js.map