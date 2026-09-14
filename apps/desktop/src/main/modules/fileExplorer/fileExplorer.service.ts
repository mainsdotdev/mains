import { promises as fs } from "fs";
import * as path from "path";
import type {
  FileNode,
  ReadDirectoryOptions,
  FileTreeResponse,
  FileContentResponse,
  ReadFileTextOptions,
  WriteFileTextOptions,
  WriteFileTextResponse,
  DirEntry,
  ListDirOptions,
  SearchFilesOptions,
} from "./fileExplorer.dto";
import {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_SEARCH_EXCLUDE_PATTERNS,
  MAX_FILE_SIZE_BYTES,
  MAX_READ_DIRECTORY_NODES,
  DEFAULT_READ_DIRECTORY_DEPTH,
  DEFAULT_SEARCH_FILES_MAX,
} from "./fileExplorer.dto";
import { gitService } from "../git";
import { assertWithinContentRoots } from "./fileExplorer.roots";


// ─────────────────────────────────────────────────────────────
// File Explorer Service
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// fs errno codes are mapped to the user-facing messages this module
// has always surfaced.
// ─────────────────────────────────────────────────────────────

/** Map fs errno codes onto user-facing messages, then throw. */
function throwFsError(
  error: unknown,
  notFoundMessage: string,
  fallbackMessage: string,
): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") throw new Error(notFoundMessage);
  if (code === "EACCES") throw new Error("Permission denied");
  if (code === "EISDIR") throw new Error("Cannot read directory as file");
  throw new Error(fallbackMessage);
}

function shouldExclude(
  name: string,
  excludePatterns: string[],
  includeHidden: boolean
): boolean {
  // Skip hidden files unless explicitly included
  if (!includeHidden && name.startsWith(".")) {
    return true;
  }

  // Check against exclude patterns
  for (const pattern of excludePatterns) {
    // Simple glob matching for now (exact match or extension)
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1);
      if (name.endsWith(ext)) return true;
    } else if (name === pattern) {
      return true;
    }
  }

  return false;
}

function getFileExtension(filename: string): string | undefined {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot > 0) {
    return filename.slice(lastDot + 1).toLowerCase();
  }
  return undefined;
}

async function readDirectoryRecursive(
  dirPath: string,
  options: {
    depth: number;
    currentDepth: number;
    includeHidden: boolean;
    excludePatterns: string[];
    maxNodes: number;
  },
  stats: { files: number; directories: number; truncated: boolean }
): Promise<FileNode[]> {
  const { depth, currentDepth, includeHidden, excludePatterns, maxNodes } =
    options;

  // Check depth limit
  if (depth !== -1 && currentDepth >= depth) {
    return [];
  }

  if (stats.files + stats.directories >= maxNodes) {
    stats.truncated = true;
    return [];
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const children: FileNode[] = [];

    // Sort: directories first, then files, alphabetically
    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    for (const entry of sortedEntries) {
      if (stats.files + stats.directories >= maxNodes) {
        stats.truncated = true;
        break;
      }
      const name = entry.name;
      const fullPath = path.join(dirPath, name);

      // Skip excluded files/directories
      if (shouldExclude(name, excludePatterns, includeHidden)) {
        continue;
      }

      if (entry.isDirectory()) {
        stats.directories++;
        const dirChildren = await readDirectoryRecursive(fullPath, {
          ...options,
          currentDepth: currentDepth + 1,
        }, stats);

        children.push({
          name,
          fullPath,
          type: "directory",
          children: dirChildren,
        });
      } else if (entry.isFile()) {
        stats.files++;

        // Get file stats for size and modification time
        let size: number | undefined;
        let modifiedAt: string | undefined;

        try {
          const fileStat = await fs.stat(fullPath);
          size = fileStat.size;
          modifiedAt = fileStat.mtime.toISOString();
        } catch {
          // Ignore stat errors for individual files
        }

        children.push({
          name,
          fullPath,
          type: "file",
          extension: getFileExtension(name),
          size,
          modifiedAt,
        });
      }
    }

    return children;
  } catch (error) {
    // Permission denied or other read errors
    console.warn(`[FileExplorer] Cannot read directory ${dirPath}:`, error);
    return [];
  }
}

export const fileExplorerService = {
  /**
   * Read a directory tree starting from rootPath
   */
  async readDirectory(
    options: ReadDirectoryOptions
  ): Promise<FileTreeResponse> {
    const {
      rootPath,
      // Undefined in callers => apply safe default depth cap.
      depth = DEFAULT_READ_DIRECTORY_DEPTH,
      // VS Code parity: dotfiles are visible by default; only the exclude
      // patterns (VCS internals, OS metadata) are hidden.
      includeHidden = true,
      excludePatterns = DEFAULT_EXCLUDE_PATTERNS,
    } = options;

    try {
      // Validate root path exists and is a directory
      const rootStat = await fs.stat(rootPath);
      if (!rootStat.isDirectory()) {
        throw new Error("Path is not a directory");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Path is not a directory") {
        throw error;
      }
      throwFsError(error, "Directory does not exist", "Failed to read directory");
    }

    const stats = { files: 0, directories: 0, truncated: false };
    const rootName = path.basename(rootPath);

    const children = await readDirectoryRecursive(
      rootPath,
      {
        depth,
        currentDepth: 0,
        includeHidden,
        excludePatterns,
        maxNodes: MAX_READ_DIRECTORY_NODES,
      },
      stats
    );

    if (stats.truncated) {
      console.warn(
        `[FileExplorer] readDirectory truncated at ${MAX_READ_DIRECTORY_NODES} nodes for ${rootPath}`,
      );
    }

    const root: FileNode = {
      name: rootName,
      fullPath: rootPath,
      type: "directory",
      children,
    };

    return {
      root,
      totalFiles: stats.files,
      totalDirectories: stats.directories,
    };
  },

  /**
   * Read a single directory level (non-recursive) for lazy loading
   */
  async readDirectoryShallow(
    dirPath: string,
    options?: { includeHidden?: boolean; excludePatterns?: string[] }
  ): Promise<FileNode[]> {
    const {
      includeHidden = true,
      excludePatterns = DEFAULT_EXCLUDE_PATTERNS,
    } = options || {};

    try {
      const dirStat = await fs.stat(dirPath);
      if (!dirStat.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const children: FileNode[] = [];

      // Sort: directories first, then files, alphabetically
      const sortedEntries = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      for (const entry of sortedEntries) {
        const name = entry.name;
        const fullPath = path.join(dirPath, name);

        if (shouldExclude(name, excludePatterns, includeHidden)) {
          continue;
        }

        if (entry.isDirectory()) {
          // Check if directory has children (for expand indicator)
          let hasChildren = false;
          try {
            const subEntries = await fs.readdir(fullPath);
            hasChildren = subEntries.some(
              (e) => !shouldExclude(e, excludePatterns, includeHidden)
            );
          } catch {
            // Can't read - assume it might have children
            hasChildren = true;
          }

          children.push({
            name,
            fullPath,
            type: "directory",
            children: hasChildren ? [] : undefined,
          });
        } else if (entry.isFile()) {
          let size: number | undefined;
          let modifiedAt: string | undefined;

          try {
            const fileStat = await fs.stat(fullPath);
            size = fileStat.size;
            modifiedAt = fileStat.mtime.toISOString();
          } catch {
            // Ignore stat errors
          }

          children.push({
            name,
            fullPath,
            type: "file",
            extension: getFileExtension(name),
            size,
            modifiedAt,
          });
        }
      }

      return children;
    } catch (error) {
      if (error instanceof Error && error.message === "Path is not a directory") {
        throw error;
      }
      console.error("[FileExplorer] Failed to read directory shallow:", error);
      throwFsError(error, "Directory does not exist", "Failed to read directory");
    }
  },

  /**
   * Check if a path exists and get basic info
   */
  async getPathInfo(
    targetPath: string
  ): Promise<{ exists: boolean; isDirectory: boolean; isFile: boolean }> {
    // Resolved before the containment check so a symlink is judged by its
    // target, and before the stat so an out-of-root path can't be probed for
    // existence — this call is what decides whether the editor opens a path.
    let realPath: string;
    try {
      realPath = await fs.realpath(path.resolve(targetPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false, isDirectory: false, isFile: false };
      }
      throw new Error("Failed to get path info");
    }

    await assertWithinContentRoots(realPath);

    try {
      const stat = await fs.stat(realPath);
      return {
        exists: true,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false, isDirectory: false, isFile: false };
      }
      throw new Error("Failed to get path info");
    }
  },

  /**
   * Read file content (basic, no security checks - use readFileText for secure reads)
   */
  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error) {
      throwFsError(error, "File does not exist", "Failed to read file");
    }
  },

  /**
   * Read file text, confined to the content roots (see fileExplorer.roots).
   * The renderer opens paths that untrusted markdown can name, so reachability
   * is decided here rather than by the caller. Keeps the regular-file / size /
   * binary safeguards.
   */
  async readFileText(
    options: ReadFileTextOptions
  ): Promise<FileContentResponse> {
    const {
      filePath,
      maxSizeBytes = MAX_FILE_SIZE_BYTES,
    } = options;

    const normalizedPath = path.resolve(filePath);

    let realPath: string;
    try {
      realPath = await fs.realpath(normalizedPath);
    } catch (error) {
      throwFsError(error, "File does not exist", "Failed to read file");
    }

    // Checked on the resolved path: a link inside a workspace that points out
    // of it escapes the boundary otherwise.
    await assertWithinContentRoots(realPath);

    try {
      // Get file stats and validate it's a regular file
      const stats = await fs.lstat(realPath);

      if (!stats.isFile()) {
        if (stats.isDirectory()) {
          throw new Error("Cannot read directory as file");
        }
        if (stats.isSymbolicLink()) {
          // Should not reach here after realpath, but safety check
          throw new Error("Cannot read symbolic link");
        }
        throw new Error("Cannot read non-regular file");
      }

      // Check file size
      if (stats.size > maxSizeBytes) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        const limitMB = (maxSizeBytes / (1024 * 1024)).toFixed(0);
        throw new Error(
          `File too large (${sizeMB}MB). Maximum size is ${limitMB}MB`,
        );
      }

      // Read file content
      const buffer = await fs.readFile(realPath);

      // Check for binary content (look for null bytes in first 8KB)
      const sampleSize = Math.min(buffer.length, 8192);
      let isBinary = false;
      for (let i = 0; i < sampleSize; i++) {
        if (buffer[i] === 0) {
          isBinary = true;
          break;
        }
      }

      if (isBinary) {
        return {
          content: "[Binary file - content cannot be displayed]",
          size: stats.size,
          isBinary: true,
          encoding: "binary",
          mtimeMs: stats.mtimeMs,
        };
      }

      // Decode as UTF-8 and validate
      const content = buffer.toString("utf-8");
      // Check for replacement character which indicates invalid UTF-8
      if (content.includes("�")) {
        // Try to determine if it's truly binary or just has some bad chars
        const replacementCount = (content.match(/�/g) || []).length;
        const ratio = replacementCount / content.length;
        if (ratio > 0.01) {
          // More than 1% replacement chars suggests binary
          return {
            content: "[Binary file - content cannot be displayed]",
            size: stats.size,
            isBinary: true,
            encoding: "binary",
            mtimeMs: stats.mtimeMs,
          };
        }
      }

      return {
        content,
        size: stats.size,
        isBinary: false,
        encoding: "utf-8",
        mtimeMs: stats.mtimeMs,
      };
    } catch (error) {
      // Domain messages pass through; raw fs errors get mapped.
      if (
        error instanceof Error &&
        !(error as NodeJS.ErrnoException).code &&
        error.message
      ) {
        throw error;
      }
      console.error("[FileExplorer] Failed to read file text:", error);
      throwFsError(error, "File does not exist", "Failed to read file");
    }
  },

  /**
   * Copy a file the renderer may read to a destination the user picked in the
   * native save dialog. The source goes through the same content-root boundary
   * as every other read; the destination needs no boundary of its own — the
   * user named it in an OS dialog, which is the authorization.
   */
  async saveFileAs(sourcePath: string, targetPath: string): Promise<void> {
    let realSource: string;
    try {
      realSource = await fs.realpath(path.resolve(sourcePath));
    } catch (error) {
      throwFsError(error, "File does not exist", "Failed to save file");
    }

    await assertWithinContentRoots(realSource);

    const stat = await fs.stat(realSource).catch((error) => {
      throwFsError(error, "File does not exist", "Failed to save file");
    });
    if (!stat.isFile()) throw new Error("Not a regular file");

    try {
      await fs.copyFile(realSource, targetPath);
    } catch (error) {
      console.error("[FileExplorer] Failed to save file:", error);
      throwFsError(error, "File does not exist", "Failed to save file");
    }
  },

  /**
   * Overwrite an existing regular file with UTF-8 text. The target must
   * already exist — this backs in-place editing of previewed files, not
   * file creation. Symlinks are resolved first so the regular-file check and
   * the content-root boundary both apply to the real target, and the same 2MB
   * cap as readFileText keeps the renderer round-trip bounded.
   */
  async writeFileText(
    options: WriteFileTextOptions
  ): Promise<WriteFileTextResponse> {
    const { filePath, content, expectedMtimeMs } = options;

    const byteLength = Buffer.byteLength(content, "utf-8");
    if (byteLength > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (byteLength / (1024 * 1024)).toFixed(2);
      const limitMB = (MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
      throw new Error(
        `Content too large (${sizeMB}MB). Maximum size is ${limitMB}MB`,
      );
    }

    const normalizedPath = path.resolve(filePath);

    let realPath: string;
    try {
      realPath = await fs.realpath(normalizedPath);
    } catch (error) {
      throwFsError(error, "File does not exist", "Failed to write file");
    }

    await assertWithinContentRoots(realPath);

    try {
      const stats = await fs.lstat(realPath);
      if (!stats.isFile()) {
        if (stats.isDirectory()) {
          throw new Error("Cannot write to a directory");
        }
        throw new Error("Cannot write to non-regular file");
      }

      // Optimistic-concurrency guard: agents write to workspace files too, so
      // a stale editor buffer must not silently clobber a newer file.
      if (expectedMtimeMs !== undefined && stats.mtimeMs !== expectedMtimeMs) {
        throw new Error("File changed on disk");
      }

      await fs.writeFile(realPath, content, "utf-8");
      const after = await fs.stat(realPath);
      return { size: byteLength, mtimeMs: after.mtimeMs };
    } catch (error) {
      // Domain messages pass through; raw fs errors get mapped.
      if (
        error instanceof Error &&
        !(error as NodeJS.ErrnoException).code &&
        error.message
      ) {
        throw error;
      }
      console.error("[FileExplorer] Failed to write file text:", error);
      throwFsError(error, "File does not exist", "Failed to write file");
    }
  },

  /**
   * Recursive substring search across the workspace tree. Matches against the
   * filename and the workspace-relative path; stops as soon as `max` matches
   * are collected. No `fs.stat` per match — keeps the hot keystroke path cheap.
   *
   * Unlike the tree listings, search skips hidden files by default and — in a
   * git repository — everything .gitignore ignores (VS Code parity: the
   * explorer shows dotfiles and build output, search doesn't crawl them).
   */
  async searchFiles(options: SearchFilesOptions): Promise<DirEntry[]> {
    const {
      rootPath,
      query,
      max = DEFAULT_SEARCH_FILES_MAX,
      includeHidden = false,
      // Non-git fallback recurses the whole tree — the wider search exclude
      // list keeps it out of node_modules (VS Code `search.exclude` parity).
      excludePatterns = DEFAULT_SEARCH_EXCLUDE_PATTERNS,
    } = options;

    const needle = query.toLowerCase();
    if (!needle) return [];

    const normalizedRoot = rootPath.replace(/\/$/, "");
    const rootPrefix = normalizedRoot + path.sep;
    const results: DirEntry[] = [];

    const walk = async (dirPath: string): Promise<void> => {
      if (results.length >= max) return;
      let entries;
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        // Permission denied / vanished directory — skip silently.
        return;
      }
      for (const entry of entries) {
        if (results.length >= max) return;
        const name = entry.name;
        if (shouldExclude(name, excludePatterns, includeHidden)) continue;
        const fullPath = path.join(dirPath, name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const relativePath = fullPath.startsWith(rootPrefix)
            ? fullPath.slice(rootPrefix.length)
            : fullPath;
          if (
            name.toLowerCase().includes(needle) ||
            relativePath.toLowerCase().includes(needle)
          ) {
            results.push({
              name,
              fullPath,
              type: "file",
              hasChildren: false,
              extension: getFileExtension(name),
            });
          }
        }
      }
    };

    try {
      const rootStat = await fs.stat(rootPath);
      if (!rootStat.isDirectory()) {
        throw new Error("Path is not a directory");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Path is not a directory") {
        throw error;
      }
      throwFsError(error, "Directory does not exist", "Failed to search files");
    }

    // In a git repo, let git decide the candidate set: tracked +
    // untracked-but-not-ignored files, so nested .gitignore rules apply
    // exactly. The exclude patterns stay on as a backstop (a repo that
    // forgot to ignore node_modules) and the hidden filter drops dotfiles.
    try {
      if (await gitService.isGitRepo(rootPath)) {
        const candidates = await gitService.listNonIgnoredFiles(rootPath);
        for (const rel of candidates) {
          if (results.length >= max) break;
          const segments = rel.split("/");
          if (
            segments.some((s) => shouldExclude(s, excludePatterns, includeHidden))
          ) {
            continue;
          }
          const name = segments[segments.length - 1];
          if (
            !name.toLowerCase().includes(needle) &&
            !rel.toLowerCase().includes(needle)
          ) {
            continue;
          }
          results.push({
            name,
            fullPath: path.join(normalizedRoot, rel),
            type: "file",
            hasChildren: false,
            extension: getFileExtension(name),
          });
        }
        return results;
      }
    } catch {
      // git enumeration failed (partial clone, corrupt index, …) — fall
      // through to the filesystem walk.
    }

    await walk(rootPath);
    return results;
  },

  // Immediate children only — no recursion. Used for lazy tree expansion.
  async listDir(options: ListDirOptions): Promise<DirEntry[]> {
    const {
      dirPath,
      includeHidden = true,
      excludePatterns = DEFAULT_EXCLUDE_PATTERNS,
    } = options;

    const resolvedPath = path.resolve(dirPath);

    try {
      // Verify it's a directory
      const dirStat = await fs.stat(resolvedPath);
      if (!dirStat.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      // Read directory entries
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      const results: DirEntry[] = [];

      // Sort: directories first, then files, alphabetically
      const sortedEntries = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      for (const entry of sortedEntries) {
        const name = entry.name;
        const fullPath = path.join(resolvedPath, name);

        // Check exclusions
        if (shouldExclude(name, excludePatterns, includeHidden)) {
          continue;
        }

        if (entry.isDirectory()) {
          // Check if this directory has any visible children
          let hasChildren = false;
          try {
            const subEntries = await fs.readdir(fullPath);
            // Check if at least one entry is visible (not excluded)
            for (const subEntry of subEntries) {
              if (!shouldExclude(subEntry, excludePatterns, includeHidden)) {
                hasChildren = true;
                break;
              }
            }
          } catch (err) {
            console.warn(`[FileExplorer] Cannot read subdir ${fullPath}:`, err);
            // Can't read subdirectory - assume it might have children
            hasChildren = true;
          }

          results.push({
            name,
            fullPath,
            type: "directory",
            hasChildren,
          });
        } else if (entry.isFile()) {
          let size: number | undefined;
          try {
            const fileStat = await fs.stat(fullPath);
            size = fileStat.size;
          } catch {
            // Ignore stat errors
          }

          results.push({
            name,
            fullPath,
            type: "file",
            hasChildren: false,
            size,
            extension: getFileExtension(name),
          });
        }
      }

      return results;
    } catch (error) {
      if (error instanceof Error && error.message === "Path is not a directory") {
        throw error;
      }
      const errCode = (error as NodeJS.ErrnoException).code;
      // A deleted directory is an ordinary outcome here (the workspace folder can
      // vanish under us); dumping the errno object made it look like a defect.
      if (errCode === "ENOENT") {
        console.warn(`[FileExplorer] listDir: directory does not exist: ${resolvedPath}`);
      } else {
        console.error(`[FileExplorer] listDir failed for ${resolvedPath}:`, error);
      }
      throwFsError(
        error,
        "Directory does not exist",
        `Failed to list directory: ${errCode || "unknown"}`,
      );
    }
  },
};
