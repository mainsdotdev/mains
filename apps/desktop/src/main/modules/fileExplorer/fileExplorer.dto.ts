// ─────────────────────────────────────────────────────────────
// File Explorer Types
// ─────────────────────────────────────────────────────────────

export type FileNodeType = "file" | "directory";

export interface FileNode {
  name: string;
  fullPath: string;
  type: FileNodeType;
  children?: FileNode[];
  /** For directories: true if has at least one visible child, undefined if not checked */
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

/** Options for listDir */
export interface ListDirOptions {
  dirPath: string;
  includeHidden?: boolean;
  excludePatterns?: string[];
}

export interface SearchFilesOptions {
  rootPath: string;
  query: string;
  max?: number;
  includeHidden?: boolean;
  excludePatterns?: string[];
}

export const DEFAULT_SEARCH_FILES_MAX = 150;

export interface ReadDirectoryOptions {
  rootPath: string;
  depth?: number; // Max recursion depth, undefined = infinite
  includeHidden?: boolean;
  excludePatterns?: string[]; // Glob patterns to exclude
}


export interface FileTreeResponse {
  root: FileNode;
  totalFiles: number;
  totalDirectories: number;
}

// File content response
export interface FileContentResponse {
  content: string;
  size: number;
  isBinary: boolean;
  encoding: "utf-8" | "binary";
  /** Disk mtime of the content read — baseline for optimistic-concurrency writes. */
  mtimeMs?: number;
}

// Read file text options
export interface ReadFileTextOptions {
  filePath: string;
  maxSizeBytes?: number; // Default 2MB
}

// Write file text options — overwrites an existing regular file
export interface WriteFileTextOptions {
  filePath: string;
  content: string;
  /**
   * Optimistic-concurrency guard: when set, the write is rejected with
   * "File changed on disk" unless the file's current mtime matches. Callers
   * get the baseline from readFileText and the refreshed value from each
   * successful write.
   */
  expectedMtimeMs?: number;
}

export interface WriteFileTextResponse {
  size: number;
  mtimeMs: number;
}

// Max file size constant (2MB)
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

// Max total nodes (files + directories) emitted by a recursive readDirectory
// call. Protects RAM on gigantic trees — callers that need more should fall
// back to listDir for lazy loading.
export const MAX_READ_DIRECTORY_NODES = 20_000;

// Default depth cap when caller does not pass a depth. The UI relies on
// `listDir` (one level) + on-demand expansion, so a small default keeps the
// initial payload tiny for callers that still reach for the recursive API.
// Deeper trees must opt in explicitly via the `depth` option.
export const DEFAULT_READ_DIRECTORY_DEPTH = 2;

// Default patterns to exclude from listings. Mirrors VS Code's `files.exclude`
// defaults: everything is visible (dotfiles, node_modules, build output)
// except VCS internals and OS metadata files.
export const DEFAULT_EXCLUDE_PATTERNS = [
  ".git",
  ".svn",
  ".hg",
  "CVS",
  ".DS_Store",
  "Thumbs.db",
];

// Search walks the whole tree, so it additionally skips dependency dirs —
// mirrors VS Code's `search.exclude` (files.exclude + node_modules etc.).
export const DEFAULT_SEARCH_EXCLUDE_PATTERNS = [
  ...DEFAULT_EXCLUDE_PATTERNS,
  "node_modules",
  "bower_components",
];
