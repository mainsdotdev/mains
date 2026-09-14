import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

const { rows } = vi.hoisted(() => ({
  rows: {
    workspaces: [] as Array<{ rootPath: string }>,
    projects: [] as Array<{ rootPath: string; workspacesPath: string | null }>,
    managedRoots: [] as string[],
  },
}));

vi.mock("../workspace", () => ({
  workspaceService: { list: async () => rows.workspaces },
}));
vi.mock("../projects", () => ({
  projectsService: { list: async () => rows.projects },
}));
vi.mock("../runs", () => ({
  managedExecutionRoots: () => rows.managedRoots,
}));

import { assertWithinContentRoots } from "./fileExplorer.roots";

let tmpDir: string;

/** The service resolves paths before checking, so tests compare like for like. */
async function realTmpDir(): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mains-roots-")));
}

describe("assertWithinContentRoots", () => {
  beforeEach(async () => {
    tmpDir = await realTmpDir();
    rows.workspaces = [];
    rows.projects = [];
    rows.managedRoots = [];
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("admits a Work run's deliverable under the managed run root", async () => {
    // Work and Chat runs have no workspace; their files land under userData,
    // and the file chip in the agent's answer has to be able to open them.
    rows.managedRoots = [path.join(tmpDir, "runs")];
    await expect(
      assertWithinContentRoots(
        path.join(tmpDir, "runs", "run-1", "work", "report.md"),
      ),
    ).resolves.toBeUndefined();
  });

  it("still rejects a path outside every root, managed ones included", async () => {
    rows.managedRoots = [path.join(tmpDir, "runs")];
    await expect(
      assertWithinContentRoots(path.join(tmpDir, "elsewhere", "secret.txt")),
    ).rejects.toThrow(/outside your workspaces/);
  });

  it("admits a file under a workspace root", async () => {
    rows.workspaces = [{ rootPath: tmpDir }];
    await expect(
      assertWithinContentRoots(path.join(tmpDir, "src", "index.ts")),
    ).resolves.toBeUndefined();
  });

  it("admits the root itself", async () => {
    rows.workspaces = [{ rootPath: tmpDir }];
    await expect(assertWithinContentRoots(tmpDir)).resolves.toBeUndefined();
  });

  it("admits a file under a project root", async () => {
    rows.projects = [{ rootPath: tmpDir, workspacesPath: null }];
    await expect(
      assertWithinContentRoots(path.join(tmpDir, "README.md")),
    ).resolves.toBeUndefined();
  });

  it("admits a file under a project's worktree parent", async () => {
    const worktrees = path.join(tmpDir, "worktrees");
    rows.projects = [{ rootPath: path.join(tmpDir, "repo"), workspacesPath: worktrees }];
    await expect(
      assertWithinContentRoots(path.join(worktrees, "feature", "a.ts")),
    ).resolves.toBeUndefined();
  });

  it("rejects a path outside every root", async () => {
    rows.workspaces = [{ rootPath: path.join(tmpDir, "repo") }];
    await expect(
      assertWithinContentRoots(path.join(os.homedir(), ".aws", "credentials")),
    ).rejects.toThrow("Path is outside your workspaces");
  });

  it("rejects a sibling directory sharing the root's name prefix", async () => {
    rows.workspaces = [{ rootPath: path.join(tmpDir, "repo") }];
    await expect(
      assertWithinContentRoots(path.join(tmpDir, "repo-secrets", "a.ts")),
    ).rejects.toThrow("Path is outside your workspaces");
  });

  it("rejects everything when no workspaces or projects exist", async () => {
    await expect(
      assertWithinContentRoots(path.join(tmpDir, "a.ts")),
    ).rejects.toThrow("Path is outside your workspaces");
  });

  it("admits a file whose root is reached through a symlinked root", async () => {
    // A root recorded via a link (macOS /tmp, or a symlinked checkout) still
    // has to admit the resolved paths the service checks.
    const realRoot = path.join(tmpDir, "real-repo");
    await fs.mkdir(realRoot);
    const linkedRoot = path.join(tmpDir, "linked-repo");
    await fs.symlink(realRoot, linkedRoot);
    rows.workspaces = [{ rootPath: linkedRoot }];

    await expect(
      assertWithinContentRoots(path.join(realRoot, "index.ts")),
    ).resolves.toBeUndefined();
  });

  it("ignores a root whose directory is gone", async () => {
    rows.workspaces = [
      { rootPath: path.join(tmpDir, "deleted") },
      { rootPath: tmpDir },
    ];
    await expect(
      assertWithinContentRoots(path.join(tmpDir, "a.ts")),
    ).resolves.toBeUndefined();
  });
});
