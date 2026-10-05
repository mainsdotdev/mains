import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { VoiceTaskLink } from "@mains/contracts/realtime";
import { emit } from "../../ipc-kit";
import { createVoiceTaskCoordinator } from "./voice-task-coordinator";
import type { RunResponse, RunTurnResponse } from "./runs.dto";
import { listPendingApprovals } from "./user-input-broker";

vi.mock("./user-input-broker", () => ({ listPendingApprovals: vi.fn(() => []) }));
const sessions: ReturnType<typeof createVoiceTaskCoordinator>[] = [];
afterEach(() => { sessions.splice(0).forEach((session) => session.dispose()); vi.useRealTimers(); vi.clearAllMocks(); });

function setup(restored: VoiceTaskLink[] = []) {
  const rows = new Map<string, RunResponse>();
  let sequence = 0;
  let active = true;
  const link = (id: string, taskKey = "hero"): VoiceTaskLink => ({
    id, taskKey, title: "Hero task", spaceId: "space", providerId: "codex_app_server",
    mode: "developer", workspaceId: "workspace", collectionId: null,
  });
  const run = (id: string) => ({ id, accountId: "account", title: "Hero task", status: "running", isArchived: false, lastError: null } as RunResponse);
  restored.forEach((task) => rows.set(task.id, run(task.id)));
  const create = vi.fn(async (args: { taskKey: string }) => {
    const task = link(`worker-${++sequence}`, args.taskKey); rows.set(task.id, run(task.id)); return task;
  });
  const turns = [{ id: 1, status: "active", responseContent: null }] as RunTurnResponse[];
  const host = {
    parentRunId: "parent", accountId: "account", links: restored, isActive: () => active,
    create, persist: vi.fn().mockResolvedValue(undefined), getRun: vi.fn(async (id: string) => rows.get(id) ?? null),
    getTurns: vi.fn(async () => turns), getArtifacts: vi.fn().mockResolvedValue([]), getTools: vi.fn().mockResolvedValue([]),
    inputAccepted: vi.fn().mockResolvedValue(false), send: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined), end: vi.fn().mockResolvedValue(undefined), notify: vi.fn(),
  };
  const coordinator = createVoiceTaskCoordinator(host); sessions.push(coordinator);
  const args = { taskKey: "hero", title: "Hero task", prompt: "Refactor the hero. Preserve the appearance." };
  return { coordinator, tools: coordinator.tools, host, rows, turns, args, link, close: () => { active = false; coordinator.dispose(); } };
}

describe("voice working-chat coordination", () => {
  it("deduplicates simultaneous creation and reuses recovered tasks, with separate chats for independent work", async () => {
    const h = setup();
    const tasks = await Promise.all([h.tools.start(h.args), h.tools.start(h.args)]);
    expect(tasks[0]).toEqual(tasks[1]);
    expect(h.host.create).toHaveBeenCalledOnce();
    expect(h.host.persist).toHaveBeenCalledOnce();
    await expect(h.tools.start(h.args)).resolves.toMatchObject({ runId: "worker-1", reused: true, status: "running" });
    await h.tools.start({ ...h.args, taskKey: "mail" });
    expect(h.host.create).toHaveBeenCalledTimes(2);
    const recovered = setup([h.link("existing")]);
    await expect(recovered.tools.start(h.args)).resolves.toMatchObject({ runId: "existing", reused: true });
    expect(recovered.host.create).not.toHaveBeenCalled();
    await expect(recovered.tools.list()).resolves.toMatchObject({ tasks: [{ taskKey: "hero", runId: "existing" }] });
  });

  it("limits all operations to linked chats owned by this account", async () => {
    const h = setup(); await h.tools.start(h.args);
    for (const call of [() => h.tools.read({ runId: "other" }), () => h.tools.cancel({ runId: "other" }),
      () => h.tools.send({ runId: "parent", message: "Do work", messageId: "one" })]) await expect(call()).rejects.toThrow("not linked");
    h.rows.get("worker-1")!.accountId = "foreign";
    await expect(h.tools.read({ runId: "worker-1" })).rejects.toThrow("unavailable");
    expect(h.host.cancel).not.toHaveBeenCalled(); expect(h.host.send).not.toHaveBeenCalled();
  });

  it("steers running work, continues idle work and deduplicates follow-up delivery", async () => {
    const h = setup(); await h.tools.start(h.args);
    const message = { runId: "worker-1", message: "Keep the title unchanged", messageId: "correction" };
    await Promise.all([h.tools.send(message), h.tools.send(message)]);
    expect(h.host.send).toHaveBeenCalledExactlyOnceWith("worker-1", message.message, expect.stringMatching(/^voice-/), true);
    await expect(h.tools.send({ ...message, message: "Different instruction" })).rejects.toThrow("new messageId");
    h.rows.get("worker-1")!.status = "succeeded";
    await h.tools.send({ ...message, messageId: "resume", message: "Continue with the footer" });
    expect(h.host.send).toHaveBeenLastCalledWith("worker-1", "Continue with the footer", expect.any(String), false);
    h.host.inputAccepted.mockResolvedValue(true);
    await h.tools.send({ ...message, messageId: "already" });
    expect(h.host.send).toHaveBeenCalledTimes(2);
  });

  it("does not resend an uncertain instruction and recovers a later acknowledgment", async () => {
    const h = setup(); await h.tools.start(h.args);
    h.host.send.mockRejectedValue(new Error("Lost response"));
    const message = { runId: "worker-1", message: "Change the color", messageId: "uncertain" };
    await expect(h.tools.send(message)).resolves.toMatchObject({ delivery: "unconfirmed" });
    await expect(h.tools.send(message)).resolves.toMatchObject({ delivery: "unconfirmed" });
    h.host.inputAccepted.mockResolvedValue(true);
    await expect(h.tools.send(message)).resolves.toMatchObject({ delivery: "accepted", reused: true });
    expect(h.host.send).toHaveBeenCalledOnce();
  });

  it("serializes idle-chat follow-ups and rereads status after the previous instruction starts a turn", async () => {
    const h = setup(); await h.tools.start(h.args);
    h.rows.get("worker-1")!.status = "succeeded";
    h.host.send.mockImplementation(async () => { h.rows.get("worker-1")!.status = "running"; });
    await Promise.all([
      h.tools.send({ runId: "worker-1", message: "Continue the task", messageId: "first" }),
      h.tools.send({ runId: "worker-1", message: "Preserve the logo too", messageId: "second" }),
    ]);
    expect(h.host.send.mock.calls.map((call) => call[3])).toEqual([false, true]);
  });

  it("coalesces progress, announces verified completion once, and detaches on closure", async () => {
    vi.useFakeTimers();
    const h = setup(); await h.tools.start(h.args); h.coordinator.activate();
    emit(CHANNELS.runs.eventPersisted, { runId: "worker-1" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.host.notify).toHaveBeenCalledTimes(1);
    expect(h.host.notify).toHaveBeenLastCalledWith(expect.stringContaining('"status":"running"'), false);
    h.rows.get("worker-1")!.status = "succeeded";
    h.turns[0].status = "completed"; h.turns[0].responseContent = "Refactor completed; tests passed.";
    emit(CHANNELS.runs.statusChanged, { runId: "worker-1" });
    emit(CHANNELS.runs.eventPersisted, { runId: "worker-1" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.host.notify).toHaveBeenCalledTimes(2);
    expect(h.host.notify).toHaveBeenLastCalledWith(expect.stringContaining("tests passed"), true);
    emit(CHANNELS.runs.eventPersisted, { runId: "worker-1" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.host.notify).toHaveBeenCalledTimes(2);
    h.close();
    emit(CHANNELS.runs.statusChanged, { runId: "worker-1" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.host.notify).toHaveBeenCalledTimes(2); expect(h.host.cancel).not.toHaveBeenCalled();
  });

  it("wakes a wait on user-action requests and releases waits when the call ends", async () => {
    vi.useFakeTimers();
    const h = setup(); await h.tools.start(h.args);
    const snapshot = await h.tools.read({ runId: "worker-1" }) as { cursor: string };
    const wait = h.tools.wait({ runId: "worker-1", afterCursor: snapshot.cursor, timeoutMs: 30000 });
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(listPendingApprovals).mockReturnValueOnce([{ requestId: "approval", kind: "tool_approval", toolName: "Command" }] as never);
    emit(CHANNELS.runs.toolApprovalRequest, { runId: "worker-1" });
    await expect(wait).resolves.toMatchObject({ needsAttention: true });
    const closingWait = h.tools.wait({ runId: "worker-1", afterCursor: snapshot.cursor, timeoutMs: 30000 });
    const rejected = expect(closingWait).rejects.toThrow("ended");
    await vi.advanceTimersByTimeAsync(0);
    h.close(); await rejected;
  });

  it("ending voice schedules closure after the tool response and leaves workers running", async () => {
    vi.useFakeTimers();
    const h = setup(); await h.tools.start(h.args);
    await expect(h.tools.end()).resolves.toEqual({ ending: true, workingChatsContinue: true });
    await h.tools.end();
    expect(h.host.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.host.end).toHaveBeenCalledOnce(); expect(h.host.cancel).not.toHaveBeenCalled();
    await h.tools.cancel({ runId: "worker-1" });
    expect(h.host.cancel).toHaveBeenCalledExactlyOnceWith("worker-1");
  });
});
