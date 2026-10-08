export declare class AgentError extends Error {
    code: string;
    constructor(message: string, code: string);
}
export declare class CommandParseError extends AgentError {
    constructor(message: string);
}
export declare class CommandExecutionError extends AgentError {
    constructor(message: string);
}
//# sourceMappingURL=errors.d.ts.map