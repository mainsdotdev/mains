import fs from "fs";
import path from "path";
import os from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_USER_DATA = path.join(os.tmpdir(), "mains-run-execution-test");

vi.mock("electron", () => ({
  app: { getPath: () => TEST_USER_DATA },
}));

import {
  managedExecutionRoots,
  managedRunDir,
  removeManagedRunDir,
  resolveRunExecution,
} from "./run-execution";

describe("resolveRunExecution", () => {
  beforeEach(() => fs.rmSync(TEST_USER_DATA, { recursive: true, force: true }));
  afterEach(() => fs.rmSync(TEST_USER_DATA, { recursive: true, force: true }));

  it("uses a real Workspace unchanged", () => {
    expect(
      resolveRunExecution({
        runId: "developer-run",
        mode: "developer",
        workspace: { id: "ws-1", rootPath: "/repo/mains" },
      }),
    ).toEqual({ workspaceId: "ws-1", cwd: "/repo/mains" });
  });

  it("creates one durable directory per Work run", () => {
    const first = resolveRunExecution({ runId: "work-1", mode: "work" });
    const second = resolveRunExecution({ runId: "work-2", mode: "work" });

    expect(first.cwd).toBe(path.join(TEST_USER_DATA, "runs", "work-1", "work"));
    expect(second.cwd).not.toBe(first.cwd);
    expect(fs.statSync(first.cwd).isDirectory()).toBe(true);
  });

  it("creates one durable directory per Chat run", () => {
    const first = resolveRunExecution({ runId: "chat-1", mode: "chat" });
    const second = resolveRunExecution({ runId: "chat-2", mode: "chat" });

    expect(first).toEqual({
      workspaceId: null,
      cwd: path.join(TEST_USER_DATA, "runs", "chat-1", "chat"),
    });
    expect(second.cwd).not.toBe(first.cwd);
    expect(fs.statSync(second.cwd).isDirectory()).toBe(true);
  });

  it("rejects a Developer run without a Workspace", () => {
    expect(() =>
      resolveRunExecution({ runId: "bad-dev", mode: "developer" }),
    ).toThrow("require a workspace");
  });
});

describe("managedRunDir", () => {
  it("gives each Work run its own directory without creating it", () => {
    // The file explorer and the renderer's file-open resolve paths against
    // this; only the run itself should be making directories.
    const dir = managedRunDir("work-42", "work");

    expect(dir).toBe(path.join(TEST_USER_DATA, "runs", "work-42", "work"));
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("gives each Chat run its own directory", () => {
    expect(managedRunDir("chat-1", "chat")).not.toBe(
      managedRunDir("chat-2", "chat"),
    );
  });

  it("rejects a run id that would escape the runs directory", () => {
    expect(() => managedRunDir("../escape", "work")).toThrow();
    expect(() => managedRunDir("../escape", "chat")).toThrow();
  });
});

describe("managedExecutionRoots", () => {
  it("covers every managed directory with the runs parent", () => {
    const roots = managedExecutionRoots();

    expect(roots).toEqual([path.join(TEST_USER_DATA, "runs")]);
    expect(managedRunDir("any-run", "work").startsWith(roots[0])).toBe(true);
    expect(managedRunDir("any-chat", "chat").startsWith(roots[0])).toBe(true);
  });
});

describe("removeManagedRunDir", () => {
  it("removes only the target run's managed tree", () => {
    const first = resolveRunExecution({ runId: "chat-1", mode: "chat" });
    const second = resolveRunExecution({ runId: "chat-2", mode: "chat" });
    fs.writeFileSync(path.join(first.cwd, "source.txt"), "first");
    fs.writeFileSync(path.join(second.cwd, "source.txt"), "second");

    removeManagedRunDir("chat-1", "chat");

    expect(fs.existsSync(first.cwd)).toBe(false);
    expect(fs.readFileSync(path.join(second.cwd, "source.txt"), "utf8")).toBe(
      "second",
    );
  });
});
