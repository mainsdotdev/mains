import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import { execFileSync } from "node:child_process";
import * as path from "path";
import * as os from "os";

// The real roots come from the database; here the boundary is driven directly
// so the service's behaviour on either side of it can be exercised. The
// containment rule itself is tested in fileExplorer.roots.test.ts.
const { allowedRoots } = vi.hoisted(() => ({ allowedRoots: [] as string[] }));
vi.mock("./fileExplorer.roots", () => ({
  assertWithinContentRoots: async (realPath: string) => {
    const nodePath = await import("path");
    const within = allowedRoots.some((root) => {
      const rel = nodePath.relative(root, realPath);
      return rel === "" || (!rel.startsWith("..") && !nodePath.isAbsolute(rel));
    });
    if (!within) throw new Error("Path is outside your workspaces");
  },
}));

import { fileExplorerService } from "./fileExplorer.service";

let tmpDir: string;

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mains-fe-test-"));
}

describe("fileExplorerService", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    // realpath: on macOS the temp dir sits behind /var → /private/var, and the
    // service checks the resolved path.
    allowedRoots.splice(0, allowedRoots.length, await fs.realpath(tmpDir));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────
  // readDirectory
  // ─────────────────────────────────────────────────────────────
  describe("readDirectory", () => {
    it("reads empty directory", async () => {
      const result = await fileExplorerService.readDirectory({ rootPath: tmpDir });
      expect(result.totalFiles).toBe(0);
      expect(result.totalDirectories).toBe(0);
      expect(result.root.children).toEqual([]);
    });

    it("reads files and directories", async () => {
      await fs.mkdir(path.join(tmpDir, "src"));
      await fs.writeFile(path.join(tmpDir, "src", "index.ts"), "export {}");
      await fs.writeFile(path.join(tmpDir, "readme.txt"), "hello");

      const result = await fileExplorerService.readDirectory({ rootPath: tmpDir });
      expect(result.totalFiles).toBe(2);
      expect(result.totalDirectories).toBe(1);
      // Directories first, then files
      expect(result.root.children![0].type).toBe("directory");
      expect(result.root.children![0].name).toBe("src");
    });

    it("respects depth limit", async () => {
      await fs.mkdir(path.join(tmpDir, "a"));
      await fs.mkdir(path.join(tmpDir, "a", "b"));
      await fs.writeFile(path.join(tmpDir, "a", "b", "deep.txt"), "deep");

      const result = await fileExplorerService.readDirectory({ rootPath: tmpDir, depth: 1 });
      // depth=1 means only read the root level
      const dirA = result.root.children!.find((c) => c.name === "a");
      expect(dirA).toBeDefined();
      expect(dirA!.children).toEqual([]); // depth limit prevents reading children
    });

    it("includes hidden files by default (VS Code parity), still hiding VCS internals", async () => {
      await fs.writeFile(path.join(tmpDir, ".hidden"), "secret");
      await fs.writeFile(path.join(tmpDir, "visible.txt"), "hi");
      await fs.mkdir(path.join(tmpDir, ".git"));

      const result = await fileExplorerService.readDirectory({ rootPath: tmpDir });
      const names = result.root.children!.map((c) => c.name);
      expect(names).toContain(".hidden");
      expect(names).toContain("visible.txt");
      expect(names).not.toContain(".git");
    });

    it("excludes hidden files when requested", async () => {
      await fs.writeFile(path.join(tmpDir, ".hidden"), "secret");
      await fs.writeFile(path.join(tmpDir, "visible.txt"), "hi");

      const result = await fileExplorerService.readDirectory({
        rootPath: tmpDir,
        includeHidden: false,
      });
      expect(result.totalFiles).toBe(1);
      expect(result.root.children![0].name).toBe("visible.txt");
    });

    it("includes hidden files when requested", async () => {
      await fs.writeFile(path.join(tmpDir, ".hidden"), "secret");
      await fs.writeFile(path.join(tmpDir, "visible.txt"), "hi");

      const result = await fileExplorerService.readDirectory({
        rootPath: tmpDir,
        includeHidden: true,
        excludePatterns: [],
      });
      expect(result.totalFiles).toBe(2);
    });

    it("applies exclude patterns", async () => {
      await fs.writeFile(path.join(tmpDir, "app.ts"), "code");
      await fs.writeFile(path.join(tmpDir, "app.log"), "logs");

      const result = await fileExplorerService.readDirectory({
        rootPath: tmpDir,
        includeHidden: true,
        excludePatterns: ["*.log"],
      });
      expect(result.totalFiles).toBe(1);
      expect(result.root.children![0].name).toBe("app.ts");
    });

    it("returns error for non-existent path", async () => {
      await expect(fileExplorerService.readDirectory({ rootPath: path.join(tmpDir, "nope"), })).rejects.toThrow("Directory does not exist");
    });

    it("returns error when path is a file", async () => {
      const filePath = path.join(tmpDir, "file.txt");
      await fs.writeFile(filePath, "hi");

      await expect(fileExplorerService.readDirectory({ rootPath: filePath })).rejects.toThrow("Path is not a directory");
    });

    it("includes file extension and size", async () => {
      await fs.writeFile(path.join(tmpDir, "test.ts"), "const x = 1;");

      const result = await fileExplorerService.readDirectory({ rootPath: tmpDir });
      const file = result.root.children![0];
      expect(file.extension).toBe("ts");
      expect(file.size).toBeGreaterThan(0);
      expect(file.modifiedAt).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // readDirectoryShallow
  // ─────────────────────────────────────────────────────────────
  describe("readDirectoryShallow", () => {
    it("reads single level", async () => {
      await fs.mkdir(path.join(tmpDir, "sub"));
      await fs.writeFile(path.join(tmpDir, "sub", "nested.txt"), "n");
      await fs.writeFile(path.join(tmpDir, "top.txt"), "t");

      const result = await fileExplorerService.readDirectoryShallow(tmpDir);
      expect(result).toHaveLength(2);

      const dir = result.find((e) => e.name === "sub");
      expect(dir!.type).toBe("directory");
      // has children since sub has nested.txt (but we need includeHidden and no exclude)
    });

    it("returns error for non-directory", async () => {
      const filePath = path.join(tmpDir, "f.txt");
      await fs.writeFile(filePath, "x");

      await expect(fileExplorerService.readDirectoryShallow(filePath)).rejects.toThrow("Path is not a directory");
    });

    it("returns error for non-existent path", async () => {
      await expect(fileExplorerService.readDirectoryShallow(path.join(tmpDir, "nope"))).rejects.toThrow("Directory does not exist");
    });

    it("sets hasChildren correctly for directories", async () => {
      await fs.mkdir(path.join(tmpDir, "empty-dir"));
      await fs.mkdir(path.join(tmpDir, "full-dir"));
      await fs.writeFile(path.join(tmpDir, "full-dir", "child.txt"), "c");

      const result = await fileExplorerService.readDirectoryShallow(tmpDir, {
        includeHidden: true,
        excludePatterns: [],
      });

      const emptyDir = result.find((e) => e.name === "empty-dir");
      const fullDir = result.find((e) => e.name === "full-dir");
      expect(emptyDir!.children).toBeUndefined(); // no children marker
      expect(fullDir!.children).toEqual([]); // has children (empty array = expandable)
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getPathInfo
  // ─────────────────────────────────────────────────────────────
  describe("getPathInfo", () => {
    it("returns info for directory", async () => {
      const result = await fileExplorerService.getPathInfo(tmpDir);
      expect(result.exists).toBe(true);
      expect(result.isDirectory).toBe(true);
      expect(result.isFile).toBe(false);
    });

    it("returns info for file", async () => {
      const filePath = path.join(tmpDir, "test.txt");
      await fs.writeFile(filePath, "hello");

      const result = await fileExplorerService.getPathInfo(filePath);
      expect(result.exists).toBe(true);
      expect(result.isFile).toBe(true);
      expect(result.isDirectory).toBe(false);
    });

    it("returns exists=false for non-existent path", async () => {
      const result = await fileExplorerService.getPathInfo(
        path.join(tmpDir, "nope")
      );
      expect(result.exists).toBe(false);
    });

    it("rejects a path outside the content roots", async () => {
      const outsideDir = await makeTmpDir();
      const outsidePath = path.join(outsideDir, "external.txt");
      await fs.writeFile(outsidePath, "external content");

      await expect(
        fileExplorerService.getPathInfo(outsidePath),
      ).rejects.toThrow("Path is outside your workspaces");

      await fs.rm(outsideDir, { recursive: true, force: true });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // readFile
  // ─────────────────────────────────────────────────────────────
  describe("readFile", () => {
    it("reads file content", async () => {
      const filePath = path.join(tmpDir, "hello.txt");
      await fs.writeFile(filePath, "hello world");

      const result = await fileExplorerService.readFile(filePath);
      expect(result).toBe("hello world");
    });

    it("returns error for non-existent file", async () => {
      await expect(fileExplorerService.readFile(path.join(tmpDir, "nope.txt"))).rejects.toThrow("File does not exist");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // readFileText
  // ─────────────────────────────────────────────────────────────
  describe("readFileText", () => {
    it("reads a valid file", async () => {
      const filePath = path.join(tmpDir, "code.ts");
      await fs.writeFile(filePath, "const x = 1;");

      const result = await fileExplorerService.readFileText({ filePath });
      expect(result.content).toBe("const x = 1;");
      expect(result.isBinary).toBe(false);
      expect(result.encoding).toBe("utf-8");
      expect(result.size).toBeGreaterThan(0);
      expect(result.mtimeMs).toBe((await fs.stat(filePath)).mtimeMs);
    });

    it("rejects a file outside the content roots", async () => {
      const outsideDir = await makeTmpDir();
      const outsidePath = path.join(outsideDir, "external.txt");
      await fs.writeFile(outsidePath, "external content");

      await expect(
        fileExplorerService.readFileText({ filePath: outsidePath }),
      ).rejects.toThrow("Path is outside your workspaces");

      await fs.rm(outsideDir, { recursive: true, force: true });
    });

    it("follows symlinks within the content roots", async () => {
      const targetFile = path.join(tmpDir, "target.txt");
      await fs.writeFile(targetFile, "linked content");

      const symlinkPath = path.join(tmpDir, "link");
      await fs.symlink(targetFile, symlinkPath);

      const result = await fileExplorerService.readFileText({
        filePath: symlinkPath,
      });
      expect(result.content).toBe("linked content");
    });

    it("rejects a symlink that escapes the content roots", async () => {
      const outsideDir = await makeTmpDir();
      const outsideFile = path.join(outsideDir, "target.txt");
      await fs.writeFile(outsideFile, "linked content");

      const symlinkPath = path.join(tmpDir, "link");
      await fs.symlink(outsideFile, symlinkPath);

      await expect(
        fileExplorerService.readFileText({ filePath: symlinkPath }),
      ).rejects.toThrow("Path is outside your workspaces");

      await fs.rm(outsideDir, { recursive: true, force: true });
    });

    // ── File size limits ──
    it("blocks files exceeding size limit", async () => {
      const filePath = path.join(tmpDir, "big.txt");
      await fs.writeFile(filePath, "x".repeat(1024));

      await expect(fileExplorerService.readFileText({ filePath, maxSizeBytes: 512, })).rejects.toThrow("File too large");
    });

    it("allows files within size limit", async () => {
      const filePath = path.join(tmpDir, "small.txt");
      await fs.writeFile(filePath, "small");

      const result = await fileExplorerService.readFileText({
        filePath,
        maxSizeBytes: 1024,
      });
      expect(result.content).toBe("small");
    });

    // ── Binary detection ──
    it("detects binary files (null bytes)", async () => {
      const filePath = path.join(tmpDir, "binary.bin");
      const buf = Buffer.alloc(100);
      buf[50] = 0; // null byte
      buf.write("hello", 0);
      await fs.writeFile(filePath, buf);

      const result = await fileExplorerService.readFileText({ filePath });
      expect(result.isBinary).toBe(true);
      expect(result.encoding).toBe("binary");
    });

    // ── Non-regular file blocking ──
    it("blocks reading a directory as file", async () => {
      const dirPath = path.join(tmpDir, "subdir");
      await fs.mkdir(dirPath);

      await expect(fileExplorerService.readFileText({ filePath: dirPath, })).rejects.toThrow("directory");
    });

    // ── File not found ──
    it("returns error for non-existent file", async () => {
      await expect(fileExplorerService.readFileText({ filePath: path.join(tmpDir, "nope.txt"), })).rejects.toThrow("File does not exist");
    });

    // ── UTF-8 content ──
    it("reads UTF-8 files with special characters", async () => {
      const filePath = path.join(tmpDir, "unicode.txt");
      await fs.writeFile(filePath, "Héllo wörld 日本語 🎉");

      const result = await fileExplorerService.readFileText({ filePath });
      expect(result.content).toBe("Héllo wörld 日本語 🎉");
      expect(result.isBinary).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // writeFileText
  // ─────────────────────────────────────────────────────────────
  describe("saveFileAs", () => {
    it("copies a readable file to the destination the user picked", async () => {
      const source = path.join(tmpDir, "report.md");
      await fs.writeFile(source, "# Report", "utf-8");
      // The destination is deliberately outside the roots: the user named it
      // in a native dialog, which is the authorization.
      const outside = await makeTmpDir();
      const target = path.join(outside, "saved.md");

      await fileExplorerService.saveFileAs(source, target);

      expect(await fs.readFile(target, "utf-8")).toBe("# Report");
      await fs.rm(outside, { recursive: true, force: true });
    });

    it("refuses a source outside the content roots", async () => {
      const outside = await makeTmpDir();
      const source = path.join(outside, "secret.txt");
      await fs.writeFile(source, "nope", "utf-8");

      await expect(
        fileExplorerService.saveFileAs(source, path.join(tmpDir, "copy.txt")),
      ).rejects.toThrow(/outside your workspaces/);
      await fs.rm(outside, { recursive: true, force: true });
    });

    it("refuses a directory", async () => {
      const dir = path.join(tmpDir, "folder");
      await fs.mkdir(dir);

      await expect(
        fileExplorerService.saveFileAs(dir, path.join(tmpDir, "copy")),
      ).rejects.toThrow(/regular file/);
    });

    it("reports a missing source", async () => {
      await expect(
        fileExplorerService.saveFileAs(
          path.join(tmpDir, "gone.md"),
          path.join(tmpDir, "copy.md"),
        ),
      ).rejects.toThrow(/does not exist/);
    });
  });

  describe("writeFileText", () => {
    it("overwrites an existing file and returns the new mtime", async () => {
      const filePath = path.join(tmpDir, "code.ts");
      await fs.writeFile(filePath, "const x = 1;");

      const result = await fileExplorerService.writeFileText({
        filePath,
        content: "const x = 2;",
      });
      expect(result.size).toBe(Buffer.byteLength("const x = 2;"));
      expect(await fs.readFile(filePath, "utf-8")).toBe("const x = 2;");
      expect(result.mtimeMs).toBe((await fs.stat(filePath)).mtimeMs);
    });

    it("accepts a write when expectedMtimeMs matches", async () => {
      const filePath = path.join(tmpDir, "code.ts");
      await fs.writeFile(filePath, "v1");
      const read = await fileExplorerService.readFileText({ filePath });

      const result = await fileExplorerService.writeFileText({
        filePath,
        content: "v2",
        expectedMtimeMs: read.mtimeMs,
      });
      expect(await fs.readFile(filePath, "utf-8")).toBe("v2");
      expect(result.mtimeMs).not.toBe(read.mtimeMs);
    });

    it("rejects a write when the file changed on disk", async () => {
      const filePath = path.join(tmpDir, "code.ts");
      await fs.writeFile(filePath, "v1");
      const read = await fileExplorerService.readFileText({ filePath });

      // Simulate an external writer (e.g. an agent) touching the file
      await fs.writeFile(filePath, "external change");
      await fs.utimes(filePath, new Date(), new Date(Date.now() + 5000));

      await expect(
        fileExplorerService.writeFileText({
          filePath,
          content: "v2",
          expectedMtimeMs: read.mtimeMs,
        }),
      ).rejects.toThrow("File changed on disk");
      expect(await fs.readFile(filePath, "utf-8")).toBe("external change");
    });

    it("writes UTF-8 content with special characters", async () => {
      const filePath = path.join(tmpDir, "unicode.txt");
      await fs.writeFile(filePath, "old");

      await fileExplorerService.writeFileText({
        filePath,
        content: "Héllo wörld 日本語 🎉",
      });
      expect(await fs.readFile(filePath, "utf-8")).toBe("Héllo wörld 日本語 🎉");
    });

    it("writes through symlinks to the real target", async () => {
      const targetFile = path.join(tmpDir, "target.txt");
      await fs.writeFile(targetFile, "original");

      const symlinkPath = path.join(tmpDir, "link");
      await fs.symlink(targetFile, symlinkPath);

      await fileExplorerService.writeFileText({
        filePath: symlinkPath,
        content: "updated",
      });
      expect(await fs.readFile(targetFile, "utf-8")).toBe("updated");
    });

    it("rejects a write whose real target escapes the content roots", async () => {
      const outsideDir = await makeTmpDir();
      const outsideFile = path.join(outsideDir, "target.txt");
      await fs.writeFile(outsideFile, "original");

      const symlinkPath = path.join(tmpDir, "link");
      await fs.symlink(outsideFile, symlinkPath);

      await expect(
        fileExplorerService.writeFileText({
          filePath: symlinkPath,
          content: "updated",
        }),
      ).rejects.toThrow("Path is outside your workspaces");
      expect(await fs.readFile(outsideFile, "utf-8")).toBe("original");

      await fs.rm(outsideDir, { recursive: true, force: true });
    });

    it("rejects non-existent files (no creation)", async () => {
      await expect(
        fileExplorerService.writeFileText({
          filePath: path.join(tmpDir, "nope.txt"),
          content: "x",
        }),
      ).rejects.toThrow("File does not exist");
    });

    it("rejects writing to a directory", async () => {
      const dirPath = path.join(tmpDir, "subdir");
      await fs.mkdir(dirPath);

      await expect(
        fileExplorerService.writeFileText({ filePath: dirPath, content: "x" }),
      ).rejects.toThrow("directory");
    });

    it("rejects content exceeding the size cap", async () => {
      const filePath = path.join(tmpDir, "big.txt");
      await fs.writeFile(filePath, "small");

      await expect(
        fileExplorerService.writeFileText({
          filePath,
          content: "x".repeat(2 * 1024 * 1024 + 1),
        }),
      ).rejects.toThrow("Content too large");
      // Original content is untouched when the cap rejects the write
      expect(await fs.readFile(filePath, "utf-8")).toBe("small");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // listDir
  // ─────────────────────────────────────────────────────────────
  describe("listDir", () => {
    it("lists directory contents", async () => {
      await fs.mkdir(path.join(tmpDir, "dir1"));
      await fs.writeFile(path.join(tmpDir, "file1.ts"), "code");

      const result = await fileExplorerService.listDir({ dirPath: tmpDir, excludePatterns: [] });
      expect(result).toHaveLength(2);

      // Directories first
      expect(result[0].type).toBe("directory");
      expect(result[0].name).toBe("dir1");
      expect(result[1].type).toBe("file");
      expect(result[1].name).toBe("file1.ts");
      expect(result[1].extension).toBe("ts");
    });

    it("reports hasChildren correctly", async () => {
      await fs.mkdir(path.join(tmpDir, "empty"));
      await fs.mkdir(path.join(tmpDir, "full"));
      await fs.writeFile(path.join(tmpDir, "full", "child.txt"), "c");

      const result = await fileExplorerService.listDir({
        dirPath: tmpDir,
        includeHidden: true,
        excludePatterns: [],
      });

      const emptyDir = result.find((e) => e.name === "empty");
      const fullDir = result.find((e) => e.name === "full");
      expect(emptyDir!.hasChildren).toBe(false);
      expect(fullDir!.hasChildren).toBe(true);
    });

    it("includes hidden files by default (VS Code parity)", async () => {
      await fs.writeFile(path.join(tmpDir, ".hidden"), "x");
      await fs.writeFile(path.join(tmpDir, "visible.txt"), "y");

      const result = await fileExplorerService.listDir({
        dirPath: tmpDir,
        excludePatterns: [],
      });
      expect(result.map((e) => e.name).sort()).toEqual([".hidden", "visible.txt"]);
    });

    it("excludes hidden files when requested", async () => {
      await fs.writeFile(path.join(tmpDir, ".hidden"), "x");
      await fs.writeFile(path.join(tmpDir, "visible.txt"), "y");

      const result = await fileExplorerService.listDir({
        dirPath: tmpDir,
        includeHidden: false,
        excludePatterns: [],
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("visible.txt");
    });

    it("returns error for non-existent directory", async () => {
      await expect(fileExplorerService.listDir({ dirPath: path.join(tmpDir, "nope"), })).rejects.toThrow("Directory does not exist");
    });

    it("returns error when path is a file", async () => {
      const filePath = path.join(tmpDir, "f.txt");
      await fs.writeFile(filePath, "x");

      await expect(fileExplorerService.listDir({ dirPath: filePath })).rejects.toThrow("Path is not a directory");
    });

    it("files have size info", async () => {
      await fs.writeFile(path.join(tmpDir, "test.js"), "console.log('hi')");

      const result = await fileExplorerService.listDir({
        dirPath: tmpDir,
        excludePatterns: [],
      });
      const file = result.find((e) => e.name === "test.js");
      expect(file!.size).toBeGreaterThan(0);
      expect(file!.hasChildren).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // searchFiles
  // ─────────────────────────────────────────────────────────────
  describe("searchFiles", () => {
    it("skips hidden files by default outside a git repo", async () => {
      await fs.writeFile(path.join(tmpDir, ".hidden.txt"), "x");
      await fs.writeFile(path.join(tmpDir, "kept.txt"), "y");

      const result = await fileExplorerService.searchFiles({
        rootPath: tmpDir,
        query: "txt",
      });
      expect(result.map((e) => e.name)).toEqual(["kept.txt"]);
    });

    it("respects .gitignore inside a git repository", async () => {
      execFileSync("git", ["init"], { cwd: tmpDir });
      await fs.writeFile(path.join(tmpDir, ".gitignore"), "ignored.txt\n");
      await fs.writeFile(path.join(tmpDir, "ignored.txt"), "x");
      await fs.writeFile(path.join(tmpDir, "kept.txt"), "y");
      await fs.writeFile(path.join(tmpDir, ".hidden.txt"), "z");

      const result = await fileExplorerService.searchFiles({
        rootPath: tmpDir,
        query: "txt",
      });
      expect(result.map((e) => e.name)).toEqual(["kept.txt"]);
      expect(result[0].fullPath).toBe(path.join(tmpDir, "kept.txt"));
    });
  });
});
