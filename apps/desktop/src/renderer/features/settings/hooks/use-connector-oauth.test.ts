// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorOAuthStartResult, ProviderConnectorsUpdatedEvent } from "@mains/contracts/provider-connectors";

const mocks = vi.hoisted(() => ({
  start: vi.fn(), open: vi.fn(), error: vi.fn(),
  listeners: new Set<(event: ProviderConnectorsUpdatedEvent) => void>(),
}));
vi.mock("@/lib/redux/api", () => ({ useStartProviderConnectorOAuthMutation: () => [mocks.start] }));
vi.mock("@/components/ui", () => ({ toast: { error: mocks.error } }));
vi.mock("@/lib/transport/events", () => ({ appEvents: { providers: {
  onConnectorsUpdated: (listener: (event: ProviderConnectorsUpdatedEvent) => void) => {
    mocks.listeners.add(listener);
    return () => { mocks.listeners.delete(listener); };
  },
} } }));
import { useConnectorOAuth } from "./use-connector-oauth";

const apiDescriptor = Object.getOwnPropertyDescriptor(window, "api");

function emit(event: ProviderConnectorsUpdatedEvent) {
  act(() => { for (const listener of mocks.listeners) listener(event); });
}

function completion(serverName: string, loginId?: string, success = true, error?: string): ProviderConnectorsUpdatedEvent {
  return { providerId: "codex", oauthLogin: { serverName, loginId, success, error } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  let nextLogin = 0;
  mocks.start.mockImplementation(({ serverName }: { serverName: string }) => ({ unwrap: async () => ({
    authorizationUrl: `https://example.com/${serverName}`, loginId: `login-${++nextLogin}`,
  }) }));
  mocks.open.mockResolvedValue(undefined);
  Object.defineProperty(window, "api", { configurable: true, value: { shell: { openExternal: mocks.open } } });
});
afterEach(() => {
  cleanup();
  mocks.listeners.clear();
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
    expect(mocks.listeners.size).toBe(0);
  });
});
