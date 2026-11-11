import { afterEach, describe, expect, it } from "vitest";
import { openGitOperations, runGitOperation, shutdownGitOperations } from "./git-operation-lifecycle";

afterEach(async () => { await shutdownGitOperations(); openGitOperations(); });
describe("Git operation retirement", () => {
  it("fences new actions and waits for an accepted action before resetting a backend generation", async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const accepted = runGitOperation({ workspaceId: "accepted", operationId: "same" }, "commit", async () => { entered(); await gate; return "old"; });
    await started;
    let closed = false; const closing = shutdownGitOperations().then(() => { closed = true; });
    try {
      await expect(runGitOperation({ workspaceId: "late" }, "push", async () => "late")).rejects.toThrow("shutting down");
      expect(closed).toBe(false);
    } finally { release(); await accepted; await closing; }
    openGitOperations();
    await expect(runGitOperation({ workspaceId: "accepted", operationId: "same" }, "commit", async (scope) => scope.step("result", async () => "new"))).resolves.toBe("new");
  });
});
