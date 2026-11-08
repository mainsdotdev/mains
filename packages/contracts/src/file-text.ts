/** Text editor concurrency contract. mtime-only clients remain compatible;
 * version-aware clients also detect replacement and unchanged-mtime writes. */
export interface FileContentResponse {
  content: string; size: number; isBinary: boolean; encoding: "utf-8" | "binary";
  mtimeMs?: number; version?: string;
}
export interface ReadFileTextOptions { filePath: string; maxSizeBytes?: number }
export interface WriteFileTextOptions {
  filePath: string; content: string; expectedMtimeMs?: number; expectedVersion?: string;
  /** Workspace mutations share the Git/Undo ownership gate when supplied. */
  workspaceId?: string;
}
export interface WriteFileTextResponse { size: number; mtimeMs: number; version?: string }
