import { describe, expect, it } from "vitest";
import { createGitActionsLifecycle } from "./git-actions-lifecycle";

describe("Git panel action ownership", () => {
  it("claims synchronously, preserves a failed request identity, and retires old completions", () => {
    const panel = createGitActionsLifecycle();
    const first = panel.begin("commitPush", "draft");
    expect(first).not.toBeNull();
    expect(panel.begin("pr", "other")).toBeNull();
    first!.finish(false);
    const retry = panel.begin("commitPush", "draft")!;
    expect(retry.operationId).toBe(first!.operationId);
    expect(first!.current()).toBe(false);
    retry.finish(true);
    const next = panel.begin("commitPush", "draft")!;
    expect(next.operationId).not.toBe(retry.operationId);
    retry.finish(false);
    expect(panel.snapshot()).toBe("commitPush");
    panel.retire();
    expect(next.signal.aborted).toBe(true);
    expect(next.current()).toBe(false);
    expect(panel.begin("pull", "")).toBeNull();
    panel.activate();
    expect(panel.begin("pull", "")!.operationId).not.toBe(next.operationId);
  });
});
