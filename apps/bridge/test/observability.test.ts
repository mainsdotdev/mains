import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe("content-free operational diagnostics", () => {
  it("turns an unexpected failure into a generic retryable response without logging its private message", async () => {
    vi.resetModules();
    const { observeBridgeRequest } = await import("../src/observability");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "email=private@example.test&cap=private-capability&code=private-recovery";
    const response = await observeBridgeRequest({ BRIDGE_ENV: "production", CF_VERSION_METADATA: { id: "11111111-1111-4111-8111-111111111111" } }, async () => { throw new Error(secret); });
    expect(response.status).toBe(503); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain(secret);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: "bridge.failure", operation: "http", status: 500, environment: "production", version: "11111111-1111-4111-8111-111111111111" });
  });
  it("emits no diagnostics for ordinary traffic and preserves response identity", async () => {
    vi.resetModules(); const { observeBridgeRequest } = await import("../src/observability");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = new Response("Unauthorized", { status: 401 });
    expect(await observeBridgeRequest({}, async () => response)).toBe(response);
    expect(log).not.toHaveBeenCalled();
  });
  it("bounds a dependency outage's log volume and excludes untrusted version metadata", async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(100_000);
    const { reportBridgeFailure } = await import("../src/observability");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 100; i++) reportBridgeFailure({ CF_VERSION_METADATA: { id: "private payload" } }, "rpc");
    expect(log).toHaveBeenCalledTimes(20); expect(JSON.stringify(log.mock.calls)).not.toContain("private payload");
    vi.advanceTimersByTime(60_000); reportBridgeFailure({}, "maintenance"); expect(log).toHaveBeenCalledTimes(21);
  });
});
