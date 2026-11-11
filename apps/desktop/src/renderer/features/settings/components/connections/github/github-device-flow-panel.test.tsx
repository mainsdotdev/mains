// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { baseApi } from "@/lib/redux/api/baseApi";
import { getTransport, resetTransport, setTransport, type Transport } from "@/lib/transport";
import { GitHubDeviceFlowPanel } from "./github-device-flow-panel";

const authorization = { deviceCode: "device-a", userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}
let store: ReturnType<typeof createStore>;
const openExternal = vi.fn().mockResolvedValue(undefined);
const invoke = vi.fn<Transport["invoke"]>();
function createStore() { return configureStore({ reducer: { api: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) }); }
function Wrapper({ children }: { children: ReactNode }) { return <StrictMode><Provider store={store}>{children}</Provider></StrictMode>; }
beforeEach(() => {
  vi.useFakeTimers(); store = createStore();
  openExternal.mockClear(); invoke.mockReset();
  invoke.mockResolvedValue({ success: true, data: authorization });
  setTransport({ kind: "fixture", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} });
  vi.stubGlobal("api", { shell: { openExternal } });
});
afterEach(() => { cleanup(); store.dispatch(baseApi.util.resetApiState()); resetTransport(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function start() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Sign in with GitHub/ })); }); }

it("does not open the browser or deliver credentials after a pending start is unmounted", async () => {
  const pending = deferred<ServiceResponse<unknown>>(); invoke.mockReturnValueOnce(pending.promise);
  const onToken = vi.fn();
  const view = render(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} />, { wrapper: Wrapper });
  await start(); view.unmount();
  await act(async () => { pending.resolve({ success: true, data: authorization }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(openExternal).not.toHaveBeenCalled();
  expect(onToken).not.toHaveBeenCalled();
  expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.connections.githubDevicePoll)).toHaveLength(0);
});

it("expires at the deadline while a poll is pending and ignores its late token", async () => {
  const poll = deferred<ServiceResponse<unknown>>();
  invoke.mockResolvedValueOnce({ success: true, data: { ...authorization, expiresIn: 10 } }).mockReturnValueOnce(poll.promise);
  const onToken = vi.fn();
  render(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} />, { wrapper: Wrapper });
  await start();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(invoke).toHaveBeenCalledWith(CHANNELS.connections.githubDevicePoll, [authorization.deviceCode]);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByText("The sign-in code expired. Start again.")).not.toBeNull();
  await act(async () => { poll.resolve({ success: true, data: { status: "success", token: "late-token" } }); });
  expect(onToken).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("permanently retires a pending token receipt across a transport swap away and back", async () => {
  const poll = deferred<ServiceResponse<unknown>>();
  invoke.mockResolvedValueOnce({ success: true, data: authorization }).mockReturnValueOnce(poll.promise);
  const onToken = vi.fn();
  render(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} />, { wrapper: Wrapper });
  await start(); await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  const original = getTransport();
  act(() => { setTransport({ ...original, kind: "replacement" }); setTransport(original); });
  await act(async () => { poll.resolve({ success: true, data: { status: "success", token: "obsolete-token" } }); });
  expect(onToken).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(900000); });
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("serializes polls and increases the minimum wait after every slow_down receipt", async () => {
  const first = deferred<ServiceResponse<unknown>>();
  invoke.mockResolvedValueOnce({ success: true, data: authorization })
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({ success: true, data: { status: "slow_down", interval: 10 } });
  render(<GitHubDeviceFlowPanel submitting={false} onToken={vi.fn()} />, { wrapper: Wrapper });
  await start();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => { first.resolve({ success: true, data: { status: "slow_down", interval: 10 } }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(9999); });
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(invoke).toHaveBeenCalledTimes(3);
  await act(async () => { await vi.advanceTimersByTimeAsync(14999); });
  expect(invoke).toHaveBeenCalledTimes(3);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(invoke).toHaveBeenCalledTimes(4);
});

it("checks wizard ownership before handing a token to the credential save tail", async () => {
  let current = true;
  const poll = deferred<ServiceResponse<unknown>>();
  invoke.mockResolvedValueOnce({ success: true, data: authorization }).mockReturnValueOnce(poll.promise);
  const onToken = vi.fn();
  render(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} isCurrent={() => current} />, { wrapper: Wrapper });
  await start(); await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  current = false;
  await act(async () => { poll.resolve({ success: true, data: { status: "success", token: "old-wizard-token" } }); });
  expect(onToken).not.toHaveBeenCalled();
});

it("keeps the code usable and permits retry when opening the browser rejects", async () => {
  openExternal.mockRejectedValueOnce(new Error("Browser unavailable"));
  invoke.mockResolvedValueOnce({ success: true, data: authorization }).mockResolvedValue({ success: true, data: { status: "pending" } });
  render(<GitHubDeviceFlowPanel submitting={false} onToken={vi.fn()} />, { wrapper: Wrapper });
  await start();
  expect(screen.getByText(authorization.userCode)).toBeDefined();
  expect(screen.queryByText("Browser unavailable")).not.toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Open GitHub/ })); });
  expect(openExternal).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(invoke).toHaveBeenCalledWith(CHANNELS.connections.githubDevicePoll, [authorization.deviceCode]);
});

it("admits only one start before React can render its loading state", async () => {
  const pending = deferred<ServiceResponse<unknown>>(); invoke.mockReturnValueOnce(pending.promise);
  render(<GitHubDeviceFlowPanel submitting={false} onToken={vi.fn()} />, { wrapper: Wrapper });
  const button = screen.getByRole("button", { name: /Sign in with GitHub/ });
  await act(async () => { fireEvent.click(button); fireEvent.click(button); });
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ success: true, data: authorization }); });
  expect(openExternal).toHaveBeenCalledOnce();
});

it("lets Cancel retire a pending poll without consuming the replacement attempt", async () => {
  const old = deferred<ServiceResponse<unknown>>();
  invoke.mockResolvedValueOnce({ success: true, data: authorization }).mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ success: true, data: { ...authorization, deviceCode: "device-b", userCode: "NEW-CODE" } })
    .mockResolvedValueOnce({ success: true, data: { status: "success", token: "new-token" } });
  const onToken = vi.fn().mockResolvedValue(undefined);
  render(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} />, { wrapper: Wrapper });
  await start(); await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" })); await start();
  await act(async () => { old.resolve({ success: true, data: { status: "success", token: "canceled-token" } }); });
  expect(screen.getByText("NEW-CODE")).toBeDefined(); expect(onToken).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(onToken.mock.calls).toEqual([["new-token"]]);
  expect(invoke).toHaveBeenLastCalledWith(CHANNELS.connections.githubDevicePoll, ["device-b"]);
});

it("cancels the scheduled poll before it can invoke the backend", async () => {
  render(<GitHubDeviceFlowPanel submitting={false} onToken={vi.fn()} />, { wrapper: Wrapper });
  await start(); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(900000); });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(authorization.userCode)).toBeNull();
});

it.each([
  [{ success: true, data: { status: "denied" } }, "Sign-in was declined on GitHub."],
  [{ success: true, data: { status: "expired" } }, "The sign-in code expired. Start again."],
  [{ success: false, error: "GitHub unavailable" }, "GitHub unavailable"],
] as const)("settles a terminal poll response and allows an explicit retry: %j", async (reply, message) => {
  invoke.mockResolvedValueOnce({ success: true, data: authorization }).mockResolvedValueOnce(reply)
    .mockResolvedValueOnce({ success: true, data: authorization });
  const onToken = vi.fn();
  render(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} />, { wrapper: Wrapper });
  await start(); await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText(message)).toBeDefined(); expect(onToken).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(900000); });
  expect(invoke).toHaveBeenCalledTimes(2);
  await start(); expect(screen.getByText(authorization.userCode)).toBeDefined();
});

it("does not poll an already expired authorization returned by a slow code request", async () => {
  const pending = deferred<ServiceResponse<unknown>>(); invoke.mockReturnValueOnce(pending.promise);
  render(<GitHubDeviceFlowPanel submitting={false} onToken={vi.fn()} />, { wrapper: Wrapper });
  await start(); await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  await act(async () => { pending.resolve({ success: true, data: { ...authorization, expiresIn: 10 } }); });
  expect(screen.getByText("The sign-in code expired. Start again.")).toBeDefined();
  expect(openExternal).not.toHaveBeenCalled(); expect(invoke).toHaveBeenCalledTimes(1);
});

it("waits the requested interval for pending responses and hands a token off once while save is pending", async () => {
  const saving = deferred<void>();
  invoke.mockResolvedValueOnce({ success: true, data: authorization })
    .mockResolvedValueOnce({ success: true, data: { status: "pending" } })
    .mockResolvedValueOnce({ success: true, data: { status: "success", token: "accepted-token" } });
  const onToken = vi.fn().mockReturnValue(saving.promise);
  render(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} />, { wrapper: Wrapper });
  await start(); await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText("Connecting to GitHub...")).toBeDefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(900000); });
  expect(onToken.mock.calls).toEqual([["accepted-token"]]);
  expect(invoke).toHaveBeenCalledTimes(3);
  await act(async () => { saving.resolve(); });
});

it("surfaces credential-handoff failure and permits a new authorization", async () => {
  invoke.mockResolvedValueOnce({ success: true, data: authorization })
    .mockResolvedValueOnce({ success: true, data: { status: "success", token: "rejected-token" } })
    .mockResolvedValueOnce({ success: true, data: authorization });
  const onToken = vi.fn().mockRejectedValueOnce(new Error("Credential save failed"));
  render(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} />, { wrapper: Wrapper });
  await start(); await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText("Credential save failed")).toBeDefined();
  await start(); expect(screen.getByText(authorization.userCode)).toBeDefined();
});

it("keeps failed code acquisition retryable without opening a browser", async () => {
  invoke.mockResolvedValueOnce({ success: false, error: "Sign-in unconfigured" });
  render(<GitHubDeviceFlowPanel submitting={false} onToken={vi.fn()} />, { wrapper: Wrapper });
  await start(); expect(screen.getByText("Sign-in unconfigured")).toBeDefined();
  expect(openExternal).not.toHaveBeenCalled();
  await start(); expect(screen.getByText(authorization.userCode)).toBeDefined();
});

it("resets the pane when its wizard scope is replaced and ignores the previous scope's token", async () => {
  const old = deferred<ServiceResponse<unknown>>();
  invoke.mockResolvedValueOnce({ success: true, data: authorization }).mockReturnValueOnce(old.promise);
  const onToken = vi.fn();
  const view = render(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} isCurrent={() => true} />, { wrapper: Wrapper });
  await start(); await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  view.rerender(<GitHubDeviceFlowPanel submitting={false} onToken={onToken} isCurrent={() => true} />);
  expect(screen.queryByText(authorization.userCode)).toBeNull();
  await act(async () => { old.resolve({ success: true, data: { status: "success", token: "old-scope-token" } }); });
  expect(onToken).not.toHaveBeenCalled();
  await start(); expect(screen.getByText(authorization.userCode)).toBeDefined();
});
