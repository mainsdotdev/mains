import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaudeTurnInput, isClaudeUserInput, type ClaudeInputMessage } from "./claude-turn-input";

const initial: ClaudeInputMessage = { type: "user", uuid: "initial", session_id: "session",
  parent_tool_use_id: null, message: { role: "user", content: "Start" } };
const guidance: ClaudeInputMessage = { ...initial, uuid: "guidance", priority: "now",
  message: { role: "user", content: "Change the approach" } };
const init = { type: "system", subtype: "init", capabilities: ["msg_lifecycle_v1"] };

async function harness(cancelled = true) {
  const cancel = vi.fn().mockResolvedValue(cancelled);
  const onInitialAccepted = vi.fn().mockResolvedValue(undefined);
  const input = createClaudeTurnInput({ initial, cancel, onInitialAccepted });
  const stream = input.stream[Symbol.asyncIterator]();
  expect((await stream.next()).value).toEqual(initial);
  await input.observe(init);
  await input.observe({ type: "user", uuid: initial.uuid, message: initial.message });
  return { input, stream, cancel, onInitialAccepted };
}

afterEach(() => { vi.useRealTimers(); });

describe("Claude turn input", () => {
  it("sends priority now on the open stream and waits for persisted native acceptance", async () => {
    const h = await harness();
    let project!: () => void;
    const projection = new Promise<void>((resolve) => { project = resolve; });
    const accepted = vi.fn(() => projection);
    const sent = h.input.send(guidance, accepted);
    let acknowledged = false;
    void sent.then(() => { acknowledged = true; });
    expect((await h.stream.next()).value).toEqual(guidance);
    await h.input.observe({ type: "command_lifecycle", command_uuid: guidance.uuid, state: "queued" });
    expect(h.input.getStatus(guidance.uuid).accepted).toBe(false);
    const echo = h.input.observe({ type: "command_lifecycle", command_uuid: guidance.uuid, state: "started" });
    let recovered = false;
    const recovery = h.input.getAcceptedStatus(guidance.uuid).then((status) => { recovered = true; return status; });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(recovered).toBe(false);
    project(); await echo;
    await expect(recovery).resolves.toMatchObject({ accepted: true, delivery: "steer" });
    await expect(sent).resolves.toEqual({ turnId: "initial", delivery: "steer" });
    await h.input.observe({ type: "user", uuid: guidance.uuid, message: guidance.message });
    await h.input.observe({ type: "assistant", user_message_uuids: [initial.uuid, guidance.uuid] });
    expect(accepted).toHaveBeenCalledOnce();
    expect(h.onInitialAccepted).toHaveBeenCalledOnce();
    await expect(h.input.send(guidance, accepted)).rejects.toThrow("already");
    h.input.finish();
  });

  it("ignores child echoes, tool results and queue admission as evidence of delivery", async () => {
    const h = await harness(); const project = vi.fn().mockResolvedValue(undefined);
    const sent = h.input.send(guidance, project); await h.stream.next();
    await h.input.observe({ type: "assistant", agent_id: "child", user_message_uuid: guidance.uuid });
    await h.input.observe({ type: "user", parent_tool_use_id: "spawn", uuid: guidance.uuid, message: guidance.message });
    await h.input.observe({ type: "user", uuid: guidance.uuid, message: { content: [{ type: "tool_result", content: "ok" }] } });
    expect(project).not.toHaveBeenCalled();
    await h.input.observe({ type: "result", user_message_uuids: [initial.uuid, guidance.uuid] });
    await expect(sent).resolves.toMatchObject({ delivery: "steer", turnId: initial.uuid });
    expect(h.cancel).not.toHaveBeenCalled();
    expect(await h.stream.next()).toMatchObject({ done: true });
    h.input.finish();
  });

  it("withdraws a message that missed the active turn without acknowledging it", async () => {
    const h = await harness(); const project = vi.fn().mockResolvedValue(undefined);
    const sent = h.input.send(guidance, project); const rejected = expect(sent).rejects.toThrow("ended before accepting");
    await h.stream.next();
    await h.input.observe({ type: "result", user_message_uuid: initial.uuid });
    await rejected;
    expect(h.cancel).toHaveBeenCalledExactlyOnceWith(guidance.uuid);
    expect(project).not.toHaveBeenCalled();
    expect(h.input.getStatus(guidance.uuid).accepted).toBe(false);
    expect(await h.stream.next()).toMatchObject({ done: true });
    await expect(h.input.send({ ...guidance, uuid: "late" }, project)).rejects.toThrow("no active");
    h.input.finish();
  });

  it("removes unsent local input instead of flushing it after the result", async () => {
    const h = await harness(); const project = vi.fn().mockResolvedValue(undefined);
    const sent = h.input.send(guidance, project); const rejected = expect(sent).rejects.toThrow("ended before accepting");
    await h.input.observe({ type: "result" }); await rejected;
    expect(h.cancel).not.toHaveBeenCalled();
    expect(await h.stream.next()).toMatchObject({ done: true });
    h.input.finish();
  });

  it("records an already dequeued late send as a continuation with its own boundary", async () => {
    const h = await harness(false); const project = vi.fn().mockResolvedValue(undefined);
    const sent = h.input.send(guidance, project); await h.stream.next();
    await h.input.observe({ type: "result", user_message_uuid: initial.uuid });
    expect(project).not.toHaveBeenCalled();
    await h.input.observe({ type: "user", uuid: guidance.uuid, message: guidance.message });
    await expect(sent).resolves.toEqual({ turnId: guidance.uuid, delivery: "queue" });
    expect(project).toHaveBeenCalledExactlyOnceWith({ turnId: guidance.uuid, delivery: "queue" });
    h.input.finish();
  });

  it("retains uncertain delivery until a later receipt confirms it", async () => {
    vi.useFakeTimers();
    const h = await harness(); const project = vi.fn().mockResolvedValue(undefined);
    const sent = h.input.send(guidance, project); const rejected = expect(sent).rejects.toThrow("Delivery is unknown");
    await h.stream.next(); await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(h.input.getStatus(guidance.uuid).accepted).toBe(false);
    await h.input.observe({ type: "stream_event", user_message_uuids: [guidance.uuid] });
    expect(h.input.getStatus(guidance.uuid)).toMatchObject({ accepted: true, delivery: "steer" });
    expect(project).toHaveBeenCalledOnce(); h.input.finish();
  });

  it("stops local delivery, rejects uncertain sends on closure and ignores late receipts", async () => {
    const h = await harness(); const project = vi.fn().mockResolvedValue(undefined);
    const sent = h.input.send(guidance, project); const rejected = expect(sent).rejects.toThrow("connection closed");
    h.input.stop(); expect(await h.stream.next()).toMatchObject({ done: true });
    await h.input.observe({ type: "user", uuid: guidance.uuid, message: guidance.message });
    expect(project).not.toHaveBeenCalled(); h.input.finish(); await rejected;
  });

  it("bounds cancellation waits without treating a stalled control request as acceptance", async () => {
    vi.useFakeTimers(); const h = await harness();
    h.cancel.mockReturnValue(new Promise(() => {}));
    const sent = h.input.send(guidance, vi.fn()); const rejected = expect(sent).rejects.toThrow("connection closed");
    await h.stream.next();
    const ending = h.input.observe({ type: "result", user_message_uuid: initial.uuid });
    await vi.advanceTimersByTimeAsync(2_000); await ending;
    expect(await h.stream.next()).toMatchObject({ done: true });
    expect(h.input.getStatus(guidance.uuid).accepted).toBe(false);
    h.input.finish(); await rejected;
  });

  it("requires native receipt capability and preserves acceptance after a projection error", async () => {
    const input = createClaudeTurnInput({ initial, cancel: vi.fn().mockResolvedValue(true) });
    await expect(input.send(guidance, vi.fn())).rejects.toThrow("still starting");
    await input.observe({ type: "system", subtype: "init", capabilities: [] });
    await expect(input.send(guidance, vi.fn())).rejects.toThrow("does not support"); input.finish();
    const h = await harness();
    const sent = h.input.send(guidance, vi.fn().mockRejectedValue(new Error("disk unavailable")));
    const rejected = expect(sent).rejects.toThrow("Delivery is unknown"); await h.stream.next();
    await expect(h.input.observe({ type: "user", uuid: guidance.uuid, message: guidance.message })).rejects.toThrow("disk unavailable");
    await rejected; expect(h.input.getStatus(guidance.uuid).accepted).toBe(true); h.input.finish();
  });
});

describe("Claude user input identity", () => {
  it("distinguishes submitted prompts from tool results for history recovery", () => {
    expect(isClaudeUserInput({ content: "prompt" })).toBe(true);
    expect(isClaudeUserInput({ content: [{ type: "text", text: "prompt" }] })).toBe(true);
    expect(isClaudeUserInput({ content: [{ type: "tool_result", content: "result" }] })).toBe(false);
    expect(isClaudeUserInput(null)).toBe(false);
  });
});
