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
export declare function executeWithAgent(transcription: string, workingDirectory?: string, sessionId?: string, signal?: AbortSignal): Promise<ExecutionResult>;
//# sourceMappingURL=executor.d.ts.map