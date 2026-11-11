import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createRun, createWorkspace } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";

let fixture: ReturnType<typeof createTestDb>;
let root: string;
let restoreRuntime: () => void;
vi.mock("../../db/client", () => ({ getDb: () => fixture.db }));

import { gitService } from "../git";
import { openGitFlow, shutdownGitFlow } from "../gitFlow/gitFlow.lifecycle";
import { createRunSession, type RunSession } from "./run-session";
import { runsService } from "./runs.service";

const sessions: RunSession[] = [];
const original = "original first line\noriginal second line\n";
const combined = "named edit by A\npeer shell edit by B\n";

beforeEach(() => {
  fixture = createTestDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-turn-ownership-"));
  restoreRuntime = installTestBackendRuntime({ getPath: (name) => path.join(root, name) });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.name", "Turn Ownership Test");
  git("config", "user.email", "turn@example.test");
  fs.writeFileSync(path.join(root, "file.txt"), original);
  git("add", "."); git("commit", "-m", "Initial");
  createWorkspace(fixture.db, { id: "workspace", rootPath: root });
  for (const id of ["mine", "peer"]) createRun(fixture.db, { id, workspaceId: "workspace", status: "running" });
});

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.finalize({ status: "canceled" })));
  await shutdownGitFlow(); openGitFlow();
  vi.restoreAllMocks(); restoreRuntime(); fixture.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

async function startSessions() {
  const capture = gitService.snapshotWorkingTree.bind(gitService);
  const baselines: Promise<string>[] = [];
  vi.spyOn(gitService, "snapshotWorkingTree").mockImplementation((...args) => {
    const snapshot = capture(...args); baselines.push(snapshot); return snapshot;
  });
  const makeSession = (runId: string) => {
    const session = createRunSession({ runId, accountId: "default", providerId: "copilot_cli",
      execution: { workspaceId: "workspace", cwd: root }, initialPromptContent: "Edit file" });
    sessions.push(session); return session;
  };
  const mine = makeSession("mine"), peer = makeSession("peer");
  // Wait for the real initial Git snapshots before either native writer acts.
  await Promise.all(baselines);
  return { mine, peer };
}

it.each([
  { ownerClosesFirst: false, peerFailed: false },
  { ownerClosesFirst: true, peerFailed: false },
  { ownerClosesFirst: false, peerFailed: true },
  { ownerClosesFirst: true, peerFailed: true },
])("preserves peer shell edits on Undo (owner closes first: $ownerClosesFirst, shell failed: $peerFailed)", async ({ ownerClosesFirst, peerFailed }) => {
  const { mine, peer } = await startSessions();
  await mine.project({ type: "tool_call", toolName: "Edit", input: { file_path: "file.txt" },
    metadata: { phase: "start", toolCallId: "named-edit" } });
  fs.writeFileSync(path.join(root, "file.txt"), "named edit by A\noriginal second line\n");
  await mine.project({ type: "tool_call", toolName: "Edit", metadata: { phase: "complete", toolCallId: "named-edit" } });
  await peer.project({ type: "tool_call", toolName: "Bash", input: { command: "python change_file.py" },
    metadata: { phase: "start", toolCallId: "peer-shell" } });
  fs.writeFileSync(path.join(root, "file.txt"), combined);
  await peer.project({ type: "tool_call", toolName: "Bash", ...(peerFailed ? { error: "Failed after writing" } : {}),
    metadata: { phase: "complete", toolCallId: "peer-shell" } });
  if (ownerClosesFirst) await mine.finalize({ status: "succeeded" });
  await peer.finalize({ status: peerFailed ? "failed" : "succeeded" });
  if (!ownerClosesFirst) await mine.finalize({ status: "succeeded" });

  const [turn] = await runsService.getTurnsByRun("mine");
  const apply = vi.spyOn(gitService, "applyPatch");
  await expect(runsService.undoTurnChanges("mine", turn.id)).rejects.toThrow(/parallel run/);
  expect(apply).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(root, "file.txt"), "utf8")).toBe(combined);
  expect((await runsService.getTurnChangesDiff("mine", turn.id))?.undoneAt).toBeNull();
  expect(turn.changes?.files).toEqual([expect.objectContaining({ path: "file.txt", shared: true })]);
});

it("allows a verified named-only Undo while preserving a peer's separate file", async () => {
  const { mine, peer } = await startSessions();
  await mine.project({ type: "tool_call", toolName: "Edit", input: { file_path: "file.txt" },
    metadata: { phase: "start", toolCallId: "mine" } });
  fs.writeFileSync(path.join(root, "file.txt"), "my edit\n");
  await mine.project({ type: "tool_call", toolName: "Edit", metadata: { phase: "complete", toolCallId: "mine" } });
  await peer.project({ type: "tool_call", toolName: "Write", input: { file_path: "peer.txt" },
    metadata: { phase: "start", toolCallId: "peer" } });
  fs.writeFileSync(path.join(root, "peer.txt"), "peer's separate work\n");
  await peer.project({ type: "tool_call", toolName: "Write", metadata: { phase: "complete", toolCallId: "peer" } });
  await peer.finalize({ status: "succeeded" }); await mine.finalize({ status: "succeeded" });

  const [turn] = await runsService.getTurnsByRun("mine");
  expect(turn.changes?.files).toEqual([expect.objectContaining({ path: "file.txt", shared: false })]);
  await expect(runsService.undoTurnChanges("mine", turn.id)).resolves.toMatchObject({ undoneAt: expect.any(Date) });
  expect(fs.readFileSync(path.join(root, "file.txt"), "utf8")).toBe(original);
  expect(fs.readFileSync(path.join(root, "peer.txt"), "utf8")).toBe("peer's separate work\n");
});
