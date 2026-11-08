// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorOAuthStartResult, ProviderConnectorsUpdatedEvent } from "@mains/contracts/provider-connectors";
import { setTransport, resetTransport } from "@/lib/transport/registry";
import type { Transport } from "@/lib/transport/types";

const mocks = vi.hoisted(() => ({
  start: vi.fn(), open: vi.fn(), error: vi.fn(),
}));
vi.mock("@/lib/redux/api", () => ({ useStartProviderConnectorOAuthMutation: () => [mocks.start] }));
vi.mock("@/components/ui", () => ({ toast: { error: mocks.error } }));
import { useConnectorOAuth } from "./use-connector-oauth";

const apiDescriptor = Object.getOwnPropertyDescriptor(window, "api");
function fakeTransport() {
  const listeners = new Set<(event: unknown) => void>();
  return {
    kind: "fixture", invoke: vi.fn(), status: () => "connected", onStatusChange: () => () => {},
    subscribe(_channel, listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    listeners,
  } satisfies Transport & { listeners: typeof listeners };
}
let transport: ReturnType<typeof fakeTransport>;

function emit(event: ProviderConnectorsUpdatedEvent) {
  act(() => { for (const listener of transport.listeners) listener(event); });
}

function completion(serverName: string, loginId?: string, success = true, error?: string): ProviderConnectorsUpdatedEvent {
  return { providerId: "codex", oauthLogin: { serverName, loginId, success, error } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  transport = fakeTransport();
  setTransport(transport);
  let nextLogin = 0;
  mocks.start.mockImplementation(({ serverName }: { serverName: string }) => ({ unwrap: async () => ({
    authorizationUrl: `https://example.com/${serverName}`, loginId: `login-${++nextLogin}`,
  }) }));
  mocks.open.mockResolvedValue(undefined);
  Object.defineProperty(window, "api", { configurable: true, value: { shell: { openExternal: mocks.open } } });
});
afterEach(() => {
  cleanup();
  resetTransport();
  if (apiDescriptor) Object.defineProperty(window, "api", apiDescriptor);
  else Reflect.deleteProperty(window, "api");
});

describe("connector OAuth completion", () => {
  it("keeps login pending after opening the browser until its own attempt completes", async () => {
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    await act(async () => { await result.current.startLogin("gmail"); });
    expect(mocks.open).toHaveBeenCalledWith("https://example.com/gmail");
    expect(result.current.isPending("gmail")).toBe(true);
    emit({ providerId: "codex" });
    emit(completion("gmail", "old-login"));
    emit(completion("gmail"));
    emit(completion("other-server", "login-1"));
    emit({ ...completion("gmail", "login-1"), providerId: "other-provider" });
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "login-1"));
    expect(result.current.isPending("gmail")).toBe(false);
  });

  it("tracks simultaneous servers independently and prevents a duplicate start", async () => {
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    await act(async () => {
      await Promise.all([result.current.startLogin("gmail"), result.current.startLogin("github")]);
      await result.current.startLogin("gmail");
    });
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(result.current.isPending("gmail")).toBe(true);
    expect(result.current.isPending("github")).toBe(true);
    emit(completion("github", "login-2"));
    expect(result.current.isPending("github")).toBe(false);
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "login-1"));
    expect(result.current.isPending("gmail")).toBe(false);
  });

  it.each(["start", "browser"])("keeps the server claimed while the %s request is pending", async (stage) => {
    const response = deferred<ConnectorOAuthStartResult>();
    const browser = deferred<void>();
    if (stage === "start") mocks.start.mockReturnValueOnce({ unwrap: () => response.promise });
    else mocks.open.mockReturnValueOnce(browser.promise);
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    let started!: Promise<void>;
    await act(async () => { started = result.current.startLogin("gmail"); });
    await act(async () => { await result.current.startLogin("gmail"); });
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(result.current.isPending("gmail")).toBe(true);
    await act(async () => {
      if (stage === "start") response.resolve({ authorizationUrl: "https://example.com/gmail", loginId: "login-1" });
      else browser.resolve();
      await started;
    });
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "login-1"));
    expect(result.current.isPending("gmail")).toBe(false);
  });

  it("matches a completion that arrives before the response against the returned loginId", async () => {
    const response = deferred<ConnectorOAuthStartResult>();
    mocks.start.mockReturnValue({ unwrap: () => response.promise });
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    let started!: Promise<void>;
    act(() => { started = result.current.startLogin("gmail"); });
    emit(completion("gmail", "current-login"));
    emit(completion("gmail", "old-login", false, "Old attempt failed"));
    await act(async () => {
      response.resolve({ authorizationUrl: "https://example.com/gmail", loginId: "current-login" });
      await started;
    });
    expect(result.current.isPending("gmail")).toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("keeps waiting when the only early completion belongs to an older attempt", async () => {
    const response = deferred<ConnectorOAuthStartResult>();
    mocks.start.mockReturnValue({ unwrap: () => response.promise });
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    let started!: Promise<void>;
    act(() => { started = result.current.startLogin("gmail"); });
    emit(completion("gmail", "old-login"));
    await act(async () => {
      response.resolve({ authorizationUrl: "https://example.com/gmail", loginId: "current-login" });
      await started;
    });
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "current-login"));
    expect(result.current.isPending("gmail")).toBe(false);
  });

  it.each([
    { loginId: "current-login", success: true },
    { loginId: "current-login", success: false },
    { loginId: undefined, success: true },
    { loginId: undefined, success: false },
  ])("settles duplicate early completions once (loginId=$loginId, success=$success)", async ({ loginId, success }) => {
    const response = deferred<ConnectorOAuthStartResult>();
    mocks.start.mockReturnValue({ unwrap: () => response.promise });
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    let started!: Promise<void>;
    act(() => { started = result.current.startLogin("gmail"); });
    emit(completion("gmail", loginId, success, "First failure"));
    emit(completion("gmail", loginId, !success, "Duplicate failure"));
    await act(async () => {
      response.resolve({ authorizationUrl: "https://example.com/gmail", loginId });
      await started;
    });
    expect(result.current.isPending("gmail")).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
    emit(completion("gmail", loginId, !success, "Late duplicate"));
    if (success) expect(mocks.error).not.toHaveBeenCalled();
    else expect(mocks.error).toHaveBeenCalledExactlyOnceWith("First failure");
  });

  it("falls back to provider and server identity for older runtimes without loginId", async () => {
    mocks.start.mockReturnValue({ unwrap: async () => ({ authorizationUrl: "https://example.com/gmail" }) });
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    await act(async () => { await result.current.startLogin("gmail"); });
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail"));
    expect(result.current.isPending("gmail")).toBe(false);
  });

  it("reports the current attempt's failure and releases its pending state", async () => {
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    await act(async () => { await result.current.startLogin("gmail"); });
    emit(completion("gmail", "old-login", false, "Old failure"));
    expect(mocks.error).not.toHaveBeenCalled();
    emit(completion("gmail", "login-1", false, "Login canceled"));
    expect(result.current.isPending("gmail")).toBe(false);
    expect(mocks.error).toHaveBeenCalledWith("Login canceled");
  });

  it.each(["start", "browser", "browser response"])("releases a failed %s request", async (failure) => {
    if (failure === "start") mocks.start.mockReturnValue({ unwrap: async () => { throw new Error("Cannot start login"); } });
    else if (failure === "browser response") mocks.open.mockResolvedValueOnce({ success: false, error: "Cannot open browser" });
    else mocks.open.mockRejectedValueOnce(new Error("Cannot open browser"));
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    await act(async () => { await result.current.startLogin("gmail"); });
    expect(result.current.isPending("gmail")).toBe(false);
    expect(mocks.error).toHaveBeenCalledWith(failure === "start" ? "Cannot start login" : "Cannot open browser");
  });

  it.each(["response", "rejection"])("ignores a browser %s failure after native completion and retry", async (failure) => {
    const browser = deferred<{ success: boolean; error: string }>();
    mocks.open.mockReturnValueOnce(browser.promise);
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    let started!: Promise<void>;
    await act(async () => { started = result.current.startLogin("gmail"); });
    expect(mocks.open).toHaveBeenCalledTimes(1);
    emit(completion("gmail", "login-1"));
    await act(async () => { await result.current.startLogin("gmail"); });
    expect(mocks.start).toHaveBeenCalledTimes(2);
    await act(async () => {
      if (failure === "response") browser.resolve({ success: false, error: "Old browser failure" });
      else browser.reject(new Error("Old browser failure"));
      await started;
    });
    expect(mocks.error).not.toHaveBeenCalled();
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "login-1", false, "Old native failure"));
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "login-2"));
    expect(result.current.isPending("gmail")).toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("disposes pending attempts on provider changes and unmount, ignoring late responses", async () => {
    const response = deferred<ConnectorOAuthStartResult>();
    mocks.start.mockReturnValue({ unwrap: () => response.promise });
    const { result, rerender, unmount } = renderHook(({ providerId }) => useConnectorOAuth(providerId), { initialProps: { providerId: "codex" } });
    let started!: Promise<void>;
    act(() => { started = result.current.startLogin("gmail"); });
    rerender({ providerId: "other-provider" });
    expect(result.current.isPending("gmail")).toBe(false);
    unmount();
    await act(async () => {
      response.resolve({ authorizationUrl: "https://example.com/gmail", loginId: "old-login" });
      await started;
    });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(transport.listeners.size).toBe(0);
  });

  it("does not restore a retired pending login when returning to its provider", async () => {
    const { result, rerender } = renderHook(({ providerId }) => useConnectorOAuth(providerId), { initialProps: { providerId: "codex" } });
    await act(async () => { await result.current.startLogin("gmail"); });
    rerender({ providerId: "other-provider" });
    rerender({ providerId: "codex" });
    expect(result.current.isPending("gmail")).toBe(false);
    await act(async () => { await result.current.startLogin("gmail"); });
    expect(mocks.start).toHaveBeenCalledTimes(2);
    emit(completion("gmail", "login-1"));
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "login-2"));
    expect(result.current.isPending("gmail")).toBe(false);
  });

  it("retires a provider's retained actions before the next view's layout effects", async () => {
    const retained: { start?: (serverName: string) => Promise<void> } = {};
    const { result, rerender } = renderHook(({ providerId }) => {
      const oauth = useConnectorOAuth(providerId);
      useLayoutEffect(() => {
        if (providerId === "other-provider") void retained.start?.("gmail");
      }, [providerId]);
      return oauth;
    }, { initialProps: { providerId: "codex" } });
    retained.start = result.current.startLogin;
    await act(async () => { rerender({ providerId: "other-provider" }); });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it.each(["start", "browser"])("ignores retained actions and late %s failures after unmount", async (stage) => {
    const response = deferred<ConnectorOAuthStartResult>();
    const browser = deferred<void>();
    if (stage === "start") mocks.start.mockReturnValueOnce({ unwrap: () => response.promise });
    else mocks.open.mockReturnValueOnce(browser.promise);
    const { result, unmount } = renderHook(() => useConnectorOAuth("codex"));
    const retainedStart = result.current.startLogin;
    let started!: Promise<void>;
    await act(async () => { started = result.current.startLogin("gmail"); });
    unmount();
    await retainedStart("github");
    if (stage === "start") response.reject(new Error("Retired start failed"));
    else browser.reject(new Error("Retired browser failed"));
    await started;
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledTimes(stage === "browser" ? 1 : 0);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(transport.listeners.size).toBe(0);
  });

  it("keeps one working subscription through StrictMode effect replay", async () => {
    const { result, unmount } = renderHook(() => useConnectorOAuth("codex"), { wrapper: StrictMode });
    expect(transport.listeners.size).toBe(1);
    await act(async () => { await result.current.startLogin("gmail"); });
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "login-1"));
    expect(result.current.isPending("gmail")).toBe(false);
    unmount();
    expect(transport.listeners.size).toBe(0);
  });

  it("retires backend-scoped attempts even when another backend reuses all native identities", async () => {
    const response = deferred<ConnectorOAuthStartResult>();
    mocks.start.mockReturnValueOnce({ unwrap: () => response.promise });
    const { result } = renderHook(() => useConnectorOAuth("codex"));
    let started!: Promise<void>;
    act(() => { started = result.current.startLogin("gmail"); });
    const oldListeners = [...transport.listeners];
    const oldStart = result.current.startLogin;
    act(() => { transport = fakeTransport(); setTransport(transport); });
    expect(result.current.isPending("gmail")).toBe(false);
    await act(async () => { await result.current.startLogin("gmail"); await oldStart("github"); });
    expect(mocks.start).toHaveBeenCalledTimes(2);
    await act(async () => {
      response.resolve({ authorizationUrl: "https://example.com/old-backend", loginId: "login-1" });
      await started;
      for (const listener of oldListeners) listener(completion("gmail", "login-1"));
    });
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith("https://example.com/gmail");
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "login-1"));
    expect(result.current.isPending("gmail")).toBe(false);
  });

  it("retires an attempt through a backend round trip even when React batches the swaps", async () => {
    const original = transport;
    const other = fakeTransport();
    const { result, unmount } = renderHook(() => useConnectorOAuth("codex"));
    await act(async () => { await result.current.startLogin("gmail"); });
    const oldStart = result.current.startLogin;
    act(() => { setTransport(other); setTransport(original); });
    expect(result.current.isPending("gmail")).toBe(false);
    await act(async () => { await oldStart("github"); await result.current.startLogin("gmail"); });
    expect(mocks.start).toHaveBeenCalledTimes(2);
    emit(completion("gmail", "login-1"));
    expect(result.current.isPending("gmail")).toBe(true);
    emit(completion("gmail", "login-2"));
    expect(result.current.isPending("gmail")).toBe(false);
    expect(original.listeners.size).toBe(1);
    expect(other.listeners.size).toBe(0);
    unmount();
    expect(original.listeners.size).toBe(0);
  });
});
