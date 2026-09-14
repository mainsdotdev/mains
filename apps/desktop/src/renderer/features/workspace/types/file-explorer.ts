export type FileNodeType = "file" | "directory";

export interface FileNode {
  name: string;
  fullPath: string;
  type: FileNodeType;
  children?: FileNode[];
  /** For directories: true if has at least one visible child */
  hasChildren?: boolean;
  size?: number;
  modifiedAt?: string;
  extension?: string;
}

/** Entry returned by listDir for lazy loading */
export interface DirEntry {
  name: string;
  fullPath: string;
  type: FileNodeType;
  /** For directories: true if has at least one visible child */
  hasChildren: boolean;
  size?: number;
  extension?: string;
}

export interface FileTreeResponse {
  root: FileNode;
  totalFiles: number;
  totalDirectories: number;
}

export interface FileContentResponse {
  content: string;
  size: number;
  isBinary: boolean;
  encoding: "utf-8" | "binary";
  /** Disk mtime of the content read — baseline for optimistic-concurrency writes. */
  mtimeMs?: number;
}

export interface WriteFileTextResponse {
  size: number;
  mtimeMs: number;
}

export type { ServiceResponse } from "../../../../shared/ipc-kit/service-response";
