import http from "http";
interface Request {
    transcription: string;
    workingDirectory?: string;
    sessionId?: string;
}
interface ResponseData {
    result?: unknown;
    error?: string;
}
declare function handleRequest(req: Request, signal?: AbortSignal): Promise<ResponseData>;
declare const server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
export { server, handleRequest };
//# sourceMappingURL=index.d.ts.map