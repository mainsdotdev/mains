import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createTestDb } from "../../../test/setup-db";
import { createWorkspace } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";

let db: DatabaseInstance, cleanup: () => void, root: string, repo: string, restore: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
const cli = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), execFile: cli.run }));
import { openGitFlow, shutdownGitFlow } from "./gitFlow.lifecycle";
import { gitFlowService } from "./gitFlow.service";
import { projectsService } from "../projects";
import { gitService } from "../git";
import { workspaceService } from "../workspace";
import { prAttachmentStorage } from "./pr-attachment-storage";
import { prAttachmentUrl } from "@mains/contracts/pr-attachments";

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
beforeEach(() => {
  ({ db, cleanup } = createTestDb());
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-git-flow-lifecycle-")); repo = path.join(root, "repo"); fs.mkdirSync(repo);
  restore = installTestBackendRuntime({ getPath: (name) => path.join(root, name) });
  git("init", "-b", "main"); git("config", "user.name", "Git Flow Test"); git("config", "user.email", "git-flow@example.test");
  fs.writeFileSync(path.join(repo, "file.txt"), "initial\n"); git("add", "."); git("commit", "-m", "Initial");
  fs.writeFileSync(path.join(repo, "file.txt"), "changed\n");
  createWorkspace(db, { id: "workspace", rootPath: repo });
  cli.run.mockReset().mockImplementation((_command: string, args: string[], _options: unknown, callback: (error: Error | null, value: { stdout: string; stderr: string }) => void) => {
    callback(null, { stdout: args.includes("--help") ? "--attach file" : args[0] === "repo" ? "https://github.com/acme/repo\n" : "https://github.com/acme/repo/pull/1\n", stderr: "" });
  });
});
afterEach(async () => { await shutdownGitFlow(); openGitFlow(); vi.restoreAllMocks(); restore(); cleanup(); fs.rmSync(root, { recursive: true, force: true }); });

describe("Git flow operation ownership", () => {
  it("joins a duplicate commit before it can stage or commit a second time", async () => {
    const gate = deferred(), entered = deferred(), commit = gitService.commit.bind(gitService);
    const native = vi.spyOn(gitService, "commit").mockImplementation(async (...args) => { entered.resolve(); await gate.promise; return commit(...args); });
    const payload = { workspaceId: "workspace", operationId: "duplicate-commit", message: "Update" };
    const first = gitFlowService.commit(payload); await entered.promise;
    const second = gitFlowService.commit(payload);
    let results!: PromiseSettledResult<unknown>[];
    try { await new Promise<void>((resolve) => setImmediate(resolve)); expect(native).toHaveBeenCalledTimes(1); }
    finally { gate.resolve(); results = await Promise.allSettled([first, second]); }
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(native).toHaveBeenCalledTimes(1); expect(git("rev-list", "--count", "HEAD")).toBe("2");
  });

  it("retries only push after the commit succeeded, without staging later edits", async () => {
    const push = vi.spyOn(gitService, "push").mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue({ branch: "main", remote: "origin" });
    const commit = vi.spyOn(gitService, "commit");
    const payload = { workspaceId: "workspace", operationId: "retry-push", message: "Update", push: true };
    await expect(gitFlowService.commit(payload)).rejects.toThrow("Connection lost");
    const committed = git("rev-parse", "HEAD"); fs.writeFileSync(path.join(repo, "file.txt"), "Later user edits\n");
    await expect(gitFlowService.commit(payload)).resolves.toMatchObject({ hash: committed, pushed: true });
    expect(commit).toHaveBeenCalledTimes(1); expect(push).toHaveBeenCalledTimes(2);
    expect(git("diff", "--cached")).toBe(""); expect(git("diff")).toContain("Later user edits");
  });

  it("keeps a successful commit acknowledged if clearing the old diff fails", async () => {
    vi.spyOn(workspaceService, "deleteDiffs").mockRejectedValueOnce(new Error("Projection unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(gitFlowService.commit({ workspaceId: "workspace", operationId: "projection-failure", message: "Update" })).resolves.toMatchObject({ hash: expect.any(String) });
    expect(git("rev-list", "--count", "HEAD")).toBe("2");
  });

  it("resumes publication after a failed push without recreating the repository or origin", async () => {
    vi.spyOn(gitService, "push").mockRejectedValueOnce(new Error("Push unavailable")).mockResolvedValue({ branch: "main", remote: "origin" });
    const payload = { workspaceId: "workspace", operationId: "publish-retry", ownerRepo: "acme/repo", visibility: "private" as const, protocol: "https" as const };
    await expect(gitFlowService.publish(payload)).rejects.toThrow("Push unavailable");
    await expect(gitFlowService.publish(payload)).resolves.toMatchObject({ url: "https://github.com/acme/repo", branch: "main" });
    expect(cli.run.mock.calls.filter(([, args]) => args[0] === "repo" && args[1] === "create")).toHaveLength(1);
    expect(git("remote", "get-url", "origin")).toBe("https://github.com/acme/repo.git");
  });

  it("keeps claimed media after a failed PR attempt, then consumes it once on success", async () => {
    git("checkout", "-b", "feature"); git("remote", "add", "origin", "https://github.com/acme/repo.git");
    const push = vi.spyOn(gitService, "push").mockRejectedValueOnce(new Error("Push unavailable")).mockResolvedValue({ branch: "feature", remote: "origin" });
    const { uploadId } = await prAttachmentStorage.write({ workspaceId: "workspace", name: "proof.png", size: 3, offset: 0, data: Buffer.from("abc").toString("base64") });
    const payload = { workspaceId: "workspace", operationId: "pr-retry", title: "Update", body: `![Proof](${prAttachmentUrl(uploadId)})`, attachmentIds: [uploadId] };
    await expect(gitFlowService.createPr(payload)).rejects.toThrow("Push unavailable");
    await expect(gitFlowService.createPr(payload)).resolves.toMatchObject({ url: "https://github.com/acme/repo/pull/1" });
    await expect(gitFlowService.createPr(payload)).resolves.toMatchObject({ url: "https://github.com/acme/repo/pull/1" });
    expect(push).toHaveBeenCalledTimes(2);
    const calls = cli.run.mock.calls.filter(([, args]) => args[0] === "pr" && args[1] === "create" && !args.includes("--help"));
    expect(calls).toHaveLength(1);
    const args = calls[0][1] as string[]; expect(fs.existsSync(args[args.indexOf("--attach") + 1])).toBe(false);
  });

  it.each(["branch", "head"])("refuses a PR retry after its %s changes", async (change) => {
    git("checkout", "-b", "feature"); git("remote", "add", "origin", "https://github.com/acme/repo.git");
    vi.spyOn(gitService, "push").mockResolvedValue({ branch: "feature", remote: "origin" });
    cli.run.mockImplementationOnce((_command, _args, _options, callback) => callback(new Error("CLI unavailable")));
    const payload = { workspaceId: "workspace", operationId: `pr-drift-${change}`, title: "Update" };
    await expect(gitFlowService.createPr(payload)).rejects.toThrow("CLI unavailable");
    if (change === "branch") git("checkout", "-b", "replacement");
    else { git("add", "."); git("commit", "-m", "Another commit"); }
    await expect(gitFlowService.createPr(payload)).rejects.toThrow("changed");
    expect(cli.run).toHaveBeenCalledTimes(1);
  });
  it("acknowledges an already created PR URL even when gh exits with an error without media", async () => {
    git("checkout", "-b", "feature"); git("remote", "add", "origin", "https://github.com/acme/repo.git");
    vi.spyOn(gitService, "push").mockResolvedValue({ branch: "feature", remote: "origin" });
    cli.run.mockImplementationOnce((_command, _args, _options, callback) => callback(Object.assign(new Error("Post-create failed"), { stdout: "https://github.com/acme/repo/pull/2", stderr: "Post-create failed" })));
    const payload = { workspaceId: "workspace", operationId: "pr-known-url", title: "Update" };
    await expect(gitFlowService.createPr(payload)).resolves.toMatchObject({ url: "https://github.com/acme/repo/pull/2", warning: "Post-create failed" });
    await expect(gitFlowService.createPr(payload)).resolves.toMatchObject({ url: "https://github.com/acme/repo/pull/2" });
    expect(cli.run).toHaveBeenCalledTimes(1);
  });

  it("reconciles an uncertain PR result before retrying the external create command", async () => {
    git("checkout", "-b", "feature"); git("remote", "add", "origin", "https://github.com/acme/repo.git");
    vi.spyOn(gitService, "push").mockResolvedValue({ branch: "feature", remote: "origin" });
    cli.run.mockImplementation((_command, args, _options, callback) => {
      if (args[1] === "list") callback(null, { stdout: JSON.stringify([{ url: "https://github.com/acme/repo/pull/9", headRefName: "feature", baseRefName: "main" }]), stderr: "" });
      else callback(new Error("Connection lost after submission"));
    });
    const payload = { workspaceId: "workspace", operationId: "pr-uncertain", title: "Update", base: "main" };
    await expect(gitFlowService.createPr(payload)).rejects.toThrow("Connection lost");
    await expect(gitFlowService.createPr(payload)).resolves.toMatchObject({ url: "https://github.com/acme/repo/pull/9" });
    expect(cli.run.mock.calls.filter(([, args]) => args[1] === "create")).toHaveLength(1);
  });

  it("does not create a second commit after losing the native commit acknowledgement", async () => {
    const commit = gitService.commit.bind(gitService);
    const native = vi.spyOn(gitService, "commit").mockImplementationOnce(async (...args) => { await commit(...args); throw new Error("Acknowledgement lost"); });
    const payload = { workspaceId: "workspace", operationId: "commit-uncertain", message: "Update" };
    await expect(gitFlowService.commit(payload)).rejects.toThrow("Acknowledgement lost");
    fs.writeFileSync(path.join(repo, "file.txt"), "Later edits\n");
    await expect(gitFlowService.commit(payload)).rejects.toThrow("changed");
    expect(native).toHaveBeenCalledTimes(1);
    expect(git("rev-list", "--count", "HEAD")).toBe("2");
    expect(git("diff", "--cached")).toBe("");
  });

  it("rejects competing branch, discard and aliased-checkout actions before they mutate Git", async () => {
    const gate = deferred(), entered = deferred(), commit = gitService.commit.bind(gitService);
    vi.spyOn(gitService, "commit").mockImplementation(async (...args) => { entered.resolve(); await gate.promise; return commit(...args); });
    const alias = path.join(root, "alias"); fs.symlinkSync(repo, alias, "dir");
    createWorkspace(db, { id: "alias-workspace", rootPath: alias });
    const pending = gitFlowService.commit({ workspaceId: "workspace", operationId: "checkout-owner", message: "Update" });
    await entered.promise;
    try {
      await expect(workspaceService.createBranch("workspace", "competing")).rejects.toThrow("already in progress");
      await expect(workspaceService.discardPaths("workspace", ["file.txt"])).rejects.toThrow("already in progress");
      await expect(gitFlowService.push("alias-workspace")).rejects.toThrow("checkout");
      expect(git("branch", "--show-current")).toBe("main");
    } finally { gate.resolve(); await pending; }
  });

  it("rejects reuse of an operation identity with a different commit draft", async () => {
    const payload = { workspaceId: "workspace", operationId: "payload-owner", message: "Update" };
    await gitFlowService.commit(payload);
    fs.writeFileSync(path.join(repo, "file.txt"), "New changes\n");
    await expect(gitFlowService.commit({ ...payload, message: "Other draft" })).rejects.toThrow("another action");
    expect(git("rev-list", "--count", "HEAD")).toBe("2");
    expect(git("diff", "--cached")).toBe("");
  });

  it("refuses to push to an origin replaced between publish attempts", async () => {
    const push = vi.spyOn(gitService, "push").mockRejectedValue(new Error("Push unavailable"));
    const payload = { workspaceId: "workspace", operationId: "publish-origin-drift", ownerRepo: "acme/repo", visibility: "private" as const, protocol: "https" as const };
    await expect(gitFlowService.publish(payload)).rejects.toThrow("Push unavailable");
    git("remote", "set-url", "origin", "https://github.com/other/repo.git");
    await expect(gitFlowService.publish(payload)).rejects.toThrow("remote changed");
    expect(push).toHaveBeenCalledTimes(1);
    expect(cli.run).toHaveBeenCalledTimes(1);
  });

  it("allows the first commit on an unborn branch", async () => {
    git("checkout", "--orphan", "first-commit"); git("rm", "-rf", ".");
    fs.writeFileSync(path.join(repo, "new.txt"), "First commit\n");
    await expect(gitFlowService.commit({ workspaceId: "workspace", operationId: "unborn-commit", message: "Initial branch commit" })).resolves.toMatchObject({ hash: expect.any(String) });
    expect(git("rev-list", "--count", "HEAD")).toBe("1");
  });

  it("rejects an invalid publish remote before creating any GitHub repository", async () => {
    await expect(gitFlowService.publish({ workspaceId: "workspace", operationId: "invalid-publish", ownerRepo: "acme/repo", visibility: "private", protocol: "https", remoteName: "-invalid" })).rejects.toThrow();
    expect(cli.run).not.toHaveBeenCalled();
    expect(git("remote")).toBe("");
  });

  it("retries only project metadata after the repository and push were already accepted", async () => {
    const projectId = (await workspaceService.get("workspace"))!.projectId!;
    const update = vi.spyOn(projectsService, "update").mockRejectedValueOnce(new Error("Metadata unavailable"));
    const push = vi.spyOn(gitService, "push").mockResolvedValue({ branch: "main", remote: "origin" });
    const payload = { workspaceId: "workspace", operationId: "publish-metadata", ownerRepo: "acme/repo", visibility: "private" as const, protocol: "https" as const };
    await expect(gitFlowService.publish(payload)).rejects.toThrow("Metadata unavailable");
    await expect(gitFlowService.publish(payload)).resolves.toMatchObject({ owner: "acme", repo: "repo" });
    expect(update).toHaveBeenCalledTimes(2); expect(push).toHaveBeenCalledTimes(1); expect(cli.run).toHaveBeenCalledTimes(1);
    expect(await projectsService.get(projectId)).toMatchObject({ remoteOrigin: "https://github.com/acme/repo", defaultBranch: "main" });
  });

});
