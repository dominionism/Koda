export interface ParsedCommand {
    action: string;
    args: string[];
    originalText: string;
}
export declare function parseTranscription(transcription: string): Promise<ParsedCommand>;
//# sourceMappingURL=command-parser.d.ts.map