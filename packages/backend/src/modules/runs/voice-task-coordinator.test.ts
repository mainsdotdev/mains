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
  return { coordinator, tools: coordinator.tools, host, rows, turns, args, link,
    deactivate: () => { active = false; }, close: () => { active = false; coordinator.dispose(); } };
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
    await expect(h.tools.cancel({ runId: "worker-1" })).rejects.toThrow("ending");
    expect(h.host.cancel).not.toHaveBeenCalled();
  });
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }

it("does not dispatch delayed closure after the host has retired the voice connection", async () => {
  vi.useFakeTimers();
  const h = setup(); await h.tools.end(); h.deactivate();
  await vi.advanceTimersByTimeAsync(250);
  expect(h.host.end).not.toHaveBeenCalled(); expect(h.host.notify).not.toHaveBeenCalled();
});

it("rejects a report that crosses two consecutive worker turn transitions", async () => {
  const h = setup(); await h.tools.start(h.args);
  const run = h.rows.get("worker-1")!;
  for (let i = 0; i < 4; i++) h.host.getRun.mockResolvedValueOnce({ ...run,
    status: i % 2 ? "succeeded" : "running", startedAt: new Date(i * 1000) });
  await expect(h.tools.read({ runId: "worker-1" })).rejects.toThrow("changed");
  expect(h.host.getTurns).toHaveBeenCalledTimes(2);
});

it("joins an existing creation until its durable link has been saved", async () => {
  const h = setup(); const saved = deferred<void>(); h.host.persist.mockReturnValueOnce(saved.promise);
  const first = h.tools.start(h.args);
  await vi.waitFor(() => expect(h.host.persist).toHaveBeenCalledOnce());
  let returned = false;
  const repeated = h.tools.start(h.args).then((result) => { returned = true; return result; });
  try {
    await new Promise((resolve) => setImmediate(resolve)); expect(returned).toBe(false);
  } finally { saved.resolve(); await Promise.all([first, repeated]); }
  expect(await repeated).toEqual(await first); expect(h.host.create).toHaveBeenCalledOnce();
});

it("claims the task key before a reentrant creation callback and retries a failed link save without recreating work", async () => {
  const h = setup();
  const create = h.host.create.getMockImplementation()!;
  let repeated: Promise<unknown> | undefined;
  h.host.create.mockImplementationOnce((args) => { repeated = h.tools.start(h.args); return create(args); });
  h.host.persist.mockRejectedValueOnce(new Error("Link storage unavailable"));
  const starting = h.tools.start(h.args);
  await expect(starting).rejects.toThrow("storage unavailable");
  await expect(repeated).rejects.toThrow("storage unavailable");
  await expect(h.tools.start(h.args)).resolves.toMatchObject({ runId: "worker-1", reused: true });
  expect(h.host.create).toHaveBeenCalledOnce(); expect(h.host.persist).toHaveBeenCalledTimes(2);
});

it("retries a completion notice after publication fails instead of consuming its receipt", async () => {
  vi.useFakeTimers();
  const h = setup(); await h.tools.start(h.args); h.rows.get("worker-1")!.status = "succeeded";
  h.host.notify.mockImplementationOnce(() => { throw new Error("Voice transport unavailable"); });
  h.coordinator.activate(); await vi.advanceTimersByTimeAsync(1500);
  emit(CHANNELS.runs.statusChanged, { runId: "worker-1" }); await vi.advanceTimersByTimeAsync(1500);
  expect(h.host.notify).toHaveBeenCalledTimes(2);
  emit(CHANNELS.runs.eventPersisted, { runId: "worker-1" }); await vi.advanceTimersByTimeAsync(1500);
  expect(h.host.notify).toHaveBeenCalledTimes(2);
});

it("delivers a late final report quietly after already announcing that the turn ended", async () => {
  vi.useFakeTimers();
  const h = setup(); await h.tools.start(h.args); h.rows.get("worker-1")!.status = "succeeded"; h.turns[0].status = "completed";
  h.coordinator.activate(); await vi.advanceTimersByTimeAsync(1500);
  expect(h.host.notify).toHaveBeenCalledWith(expect.stringContaining('"status":"succeeded"'), true);
  h.turns[0].responseContent = "Verified final report; tests passed.";
  emit(CHANNELS.runs.eventPersisted, { runId: "worker-1" }); await vi.advanceTimersByTimeAsync(1500);
  expect(h.host.notify).toHaveBeenCalledTimes(2);
  expect(h.host.notify).toHaveBeenLastCalledWith(expect.stringContaining("Verified final report"), false);
  emit(CHANNELS.runs.eventPersisted, { runId: "worker-1" }); await vi.advanceTimersByTimeAsync(1500);
  expect(h.host.notify).toHaveBeenCalledTimes(2); expect(h.host.end).not.toHaveBeenCalled(); expect(h.host.cancel).not.toHaveBeenCalled();
});

it("preserves follow-up admission order even when the earlier ownership read is slow", async () => {
  const h = setup(); await h.tools.start(h.args);
  const earlier = deferred<RunResponse | null>(); h.host.getRun.mockImplementationOnce(() => earlier.promise);
  const first = h.tools.send({ runId: "worker-1", message: "First correction", messageId: "first" });
  const second = h.tools.send({ runId: "worker-1", message: "Second correction", messageId: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  earlier.resolve(h.rows.get("worker-1")!); await Promise.all([first, second]);
  expect(h.host.send.mock.calls.map((call) => call[1])).toEqual(["First correction", "Second correction"]);
});

it("retires admitted follow-ups as soon as Stop is requested, before its ownership read settles", async () => {
  const h = setup(); await h.tools.start(h.args);
  const probe = deferred<boolean>(); h.host.inputAccepted.mockReturnValueOnce(probe.promise);
  const sending = h.tools.send({ runId: "worker-1", message: "Do not restart after stop", messageId: "queued" }).catch((error: unknown) => error);
  await vi.waitFor(() => expect(h.host.inputAccepted).toHaveBeenCalledOnce());
  const authorization = deferred<RunResponse | null>(); h.host.getRun.mockImplementationOnce(() => authorization.promise);
  const stopping = h.tools.cancel({ runId: "worker-1" });
  probe.resolve(false); await new Promise((resolve) => setImmediate(resolve));
  authorization.resolve(h.rows.get("worker-1")!); await stopping;
  expect(h.host.send).not.toHaveBeenCalled(); expect(await sending).toBeInstanceOf(Error);
});

it("waits for the worker's pending cancellation before delivering a later explicit follow-up", async () => {
  const h = setup(); await h.tools.start(h.args);
  const stopped = deferred<void>();
  h.host.cancel.mockImplementationOnce(async () => { await stopped.promise; h.rows.get("worker-1")!.status = "canceled"; });
  const stopping = h.tools.cancel({ runId: "worker-1" });
  await vi.waitFor(() => expect(h.host.cancel).toHaveBeenCalledOnce());
  const resuming = h.tools.send({ runId: "worker-1", message: "Continue with the next step", messageId: "resume-after-stop" });
  try {
    await new Promise((resolve) => setImmediate(resolve)); expect(h.host.send).not.toHaveBeenCalled();
  } finally { stopped.resolve(); await Promise.all([stopping, resuming]); }
  expect(h.host.send).toHaveBeenCalledWith("worker-1", "Continue with the next step", expect.any(String), false);
});

it("saves an admitted worker after voice closes so the next call can recover it", async () => {
  const h = setup(); const created = deferred<VoiceTaskLink>(); h.host.create.mockReturnValueOnce(created.promise);
  const starting = h.tools.start(h.args);
  await vi.waitFor(() => expect(h.host.create).toHaveBeenCalledOnce());
  h.close(); created.resolve(h.link("late-worker"));
  await expect(starting).resolves.toMatchObject({ runId: "late-worker", status: "started" });
  expect(h.host.persist).toHaveBeenCalledExactlyOnceWith(h.link("late-worker"));
  expect(h.host.notify).not.toHaveBeenCalled(); expect(h.host.cancel).not.toHaveBeenCalled();
});

it("allows explicit retry after creation or delivery preparation fails before dispatch", async () => {
  const h = setup(); h.host.create.mockRejectedValueOnce(new Error("Cannot prepare worker"));
  await expect(h.tools.start(h.args)).rejects.toThrow("prepare worker");
  await h.tools.start(h.args);
  const message = { runId: "worker-1", message: "Correction", messageId: "retry-preparation" };
  h.host.getRun.mockRejectedValueOnce(new Error("Cannot inspect worker"));
  await expect(h.tools.send(message)).rejects.toThrow("inspect worker");
  await expect(h.tools.send(message)).resolves.toMatchObject({ delivery: "accepted" });
  expect(h.host.send).toHaveBeenCalledOnce();
});

it("does not dispatch a prepared instruction or a pending announcement after voice closes", async () => {
  vi.useFakeTimers();
  const h = setup(); await h.tools.start(h.args);
  const acknowledgment = deferred<boolean>(); h.host.inputAccepted.mockReturnValueOnce(acknowledgment.promise);
  const sending = h.tools.send({ runId: "worker-1", message: "Late correction", messageId: "late" });
  const rejected = expect(sending).rejects.toThrow("ended");
  await vi.advanceTimersByTimeAsync(0);
  const inspection = deferred<RunResponse | null>(); h.host.getRun.mockReturnValueOnce(inspection.promise);
  h.coordinator.activate(); await vi.advanceTimersByTimeAsync(1500);
  h.close(); acknowledgment.resolve(false); inspection.resolve(h.rows.get("worker-1")!);
  await rejected; await vi.advanceTimersByTimeAsync(30000);
  expect(h.host.send).not.toHaveBeenCalled(); expect(h.host.notify).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it("keeps different workers independent when one follow-up is waiting on provider acceptance", async () => {
  const h = setup(); await h.tools.start(h.args); await h.tools.start({ ...h.args, taskKey: "other" });
  const acceptance = deferred<boolean>(); h.host.inputAccepted.mockReturnValueOnce(acceptance.promise);
  const first = h.tools.send({ runId: "worker-1", message: "First worker", messageId: "one" });
  await vi.waitFor(() => expect(h.host.inputAccepted).toHaveBeenCalledOnce());
  await h.tools.send({ runId: "worker-2", message: "Other worker", messageId: "two" });
  expect(h.host.send).toHaveBeenCalledExactlyOnceWith("worker-2", "Other worker", expect.any(String), true);
  acceptance.resolve(false); await first;
});

it("coalesces concurrent Stop requests and permits a later explicit retry after native failure", async () => {
  const h = setup(); await h.tools.start(h.args);
  const stopping = deferred<void>(); h.host.cancel.mockReturnValueOnce(stopping.promise);
  const first = h.tools.cancel({ runId: "worker-1" }); const duplicate = h.tools.cancel({ runId: "worker-1" });
  await vi.waitFor(() => expect(h.host.cancel).toHaveBeenCalledOnce()); stopping.resolve();
  await Promise.all([first, duplicate]);
  h.host.cancel.mockRejectedValueOnce(new Error("Native stop failed"));
  await expect(h.tools.cancel({ runId: "worker-1" })).rejects.toThrow("stop failed");
  await h.tools.cancel({ runId: "worker-1" }); expect(h.host.cancel).toHaveBeenCalledTimes(3);
});

it("fences queued work while ending and reopens admission only after closure fails", async () => {
  vi.useFakeTimers();
  const h = setup(); await h.tools.start(h.args);
  const acceptance = deferred<boolean>(); h.host.inputAccepted.mockReturnValueOnce(acceptance.promise);
  const sending = h.tools.send({ runId: "worker-1", message: "Queued correction", messageId: "before-end" });
  const rejected = expect(sending).rejects.toThrow("ending"); await vi.advanceTimersByTimeAsync(0);
  h.host.end.mockRejectedValueOnce(new Error("Native closure failed"));
  await h.tools.end(); acceptance.resolve(false); await rejected;
  await expect(h.tools.start({ ...h.args, taskKey: "forbidden" })).rejects.toThrow("ending");
  await vi.advanceTimersByTimeAsync(250);
  expect(h.host.notify).toHaveBeenCalledWith(expect.stringContaining("closure failed"), true);
  await expect(h.tools.read({ runId: "worker-1" })).resolves.toMatchObject({ status: "running" });
  await h.tools.end(); await vi.advanceTimersByTimeAsync(250);
  expect(h.host.end).toHaveBeenCalledTimes(2); expect(h.host.send).not.toHaveBeenCalled(); expect(h.host.cancel).not.toHaveBeenCalled();
});

it("does not revive a retired follow-up when failed closure reopens the same voice connection", async () => {
  vi.useFakeTimers();
  const h = setup(); await h.tools.start(h.args);
  const acceptance = deferred<boolean>(); h.host.inputAccepted.mockReturnValueOnce(acceptance.promise);
  const sending = h.tools.send({ runId: "worker-1", message: "Old pending correction", messageId: "retired" });
  const rejected = expect(sending).rejects.toThrow("ending"); await vi.advanceTimersByTimeAsync(0);
  h.host.end.mockRejectedValueOnce(new Error("Closure failed")); await h.tools.end(); await vi.advanceTimersByTimeAsync(250);
  acceptance.resolve(false); await rejected;
  await h.tools.send({ runId: "worker-1", message: "New explicit correction", messageId: "new" });
  expect(h.host.send).toHaveBeenCalledExactlyOnceWith("worker-1", "New explicit correction", expect.any(String), true);
});

it("retires an inspection that spans ending and reopening instead of publishing its old result", async () => {
  vi.useFakeTimers();
  const h = setup(); await h.tools.start(h.args); h.rows.get("worker-1")!.status = "succeeded";
  const inspected = deferred<RunTurnResponse[]>(); h.host.getTurns.mockReturnValueOnce(inspected.promise);
  h.coordinator.activate(); await vi.advanceTimersByTimeAsync(1500);
  h.host.end.mockRejectedValueOnce(new Error("Closure failed")); await h.tools.end(); await vi.advanceTimersByTimeAsync(250);
  inspected.resolve(h.turns); await vi.advanceTimersByTimeAsync(0);
  expect(h.host.notify).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1500); expect(h.host.notify).toHaveBeenCalledTimes(2);
});

it("keeps a new wait registered when an older retired subscription finishes its recheck", async () => {
  vi.useFakeTimers();
  const h = setup(); await h.tools.start(h.args);
  const { cursor } = await h.tools.read({ runId: "worker-1" }) as { cursor: string };
  const rechecked = deferred<RunTurnResponse[]>();
  h.host.getTurns.mockResolvedValueOnce(h.turns).mockReturnValueOnce(rechecked.promise);
  const older = expect(h.tools.wait({ runId: "worker-1", afterCursor: cursor })).rejects.toThrow("ending");
  await vi.advanceTimersByTimeAsync(0);
  h.host.end.mockRejectedValueOnce(new Error("Closure failed")); await h.tools.end(); await older; await vi.advanceTimersByTimeAsync(250);
  const newer = expect(h.tools.wait({ runId: "worker-1", afterCursor: cursor })).rejects.toThrow("ended");
  await vi.advanceTimersByTimeAsync(0);
  rechecked.resolve([{ ...h.turns[0], responseContent: "Older inspection result" }]); await vi.advanceTimersByTimeAsync(0);
  h.close();
  try { expect(vi.getTimerCount()).toBe(0); }
  finally { await vi.advanceTimersByTimeAsync(30000); await newer; }
});

it("releases all waits on ending and bounds an unchanged worker wait to thirty seconds", async () => {
  vi.useFakeTimers();
  const h = setup(); await h.tools.start(h.args);
  const { cursor } = await h.tools.read({ runId: "worker-1" }) as { cursor: string };
  const bounded = h.tools.wait({ runId: "worker-1", afterCursor: cursor, timeoutMs: 90000 });
  await vi.advanceTimersByTimeAsync(30000);
  await expect(bounded).resolves.toMatchObject({ cursor }); expect(vi.getTimerCount()).toBe(0);
  const waits = [1, 2].map(() => expect(h.tools.wait({ runId: "worker-1", afterCursor: cursor })).rejects.toThrow("ending"));
  await vi.advanceTimersByTimeAsync(0); await h.tools.end(); await Promise.all(waits);
  h.close(); await vi.advanceTimersByTimeAsync(30000); expect(vi.getTimerCount()).toBe(0); expect(h.host.end).not.toHaveBeenCalled();
});
