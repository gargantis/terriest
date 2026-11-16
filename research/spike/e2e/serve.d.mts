// Types for e2e/serve.mjs.
export interface HeaderRule {
  pattern: string;
  headers: [string, string][];
  detach: string[];
}
export declare const DIST: string;
export declare function parseHeadersFile(text: string): HeaderRule[];
export declare function headersFor(rules: HeaderRule[], path: string, host?: string): [string, string][];
export declare function addSources(csp: string, directive: string, sources: string[]): string;
export interface Server {
  port: number;
  url: string;
  close: () => Promise<void>;
}
export declare function startServer(options?: {
  distDir?: string;
  port?: number;
  host?: string;
  rewriteCsp?: (value: string) => string;
  extraHeaders?: [string, string][];
  compress?: boolean;
}): Promise<Server>;
