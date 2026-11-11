// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { baseApi } from "@/lib/redux/api/baseApi";
import backendsReducer from "@/lib/redux/slices/backendsSlice";
import { resetTransport, setTransport } from "@/lib/transport";
import GitHubModal from "./github-modal";

// Keep the actual GitHub pane, wizard steps, Redux endpoints and transport.
// Replace only modal presentation and its minimum animation delay.
vi.mock("@/lib/with-min-delay", () => ({ withMinDelay: <T,>(work: Promise<T>) => work }));
vi.mock("@/components/ui", async (original) => {
  const ui = await original<any>();
  const { WizardProvider } = await import("@/components/ui/wizard-modal/wizard-context");
  const React = await import("react");
  return { ...ui, WizardModal: ({ steps, initialData, onCancel }: any) => {
    const [step, goTo] = React.useState("loading"), [data, update] = React.useState(initialData);
    React.useEffect(() => { update((old: any) => ({ ...old, ...initialData })); }, [initialData]);
    const setData = React.useCallback((next: any) => update((old: any) => ({ ...old, ...next })), []);
    return <WizardProvider value={{ data, setData, goTo } as any}><button onClick={onCancel}>Close wizard</button>{steps.find((s: any) => s.id === step)?.render()}</WizardProvider>;
  } };
});
const disposers: Array<() => void> = [];
const authorization = { deviceCode: "device-code", userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 };
function fixture() {
  let finish!: (value: ServiceResponse<unknown>) => void;
  const poll = new Promise<ServiceResponse<unknown>>((resolve) => { finish = resolve; });
  const invoke = vi.fn(async (channel: string, _args: unknown[] = []): Promise<ServiceResponse<unknown>> => {
    if (channel === CHANNELS.connections.githubDevicePoll) return poll;
    const data = channel === CHANNELS.appSettings.get ? { accountId: "account" }
      : channel === CHANNELS.connections.getByProvider ? { connection: { id: "conn", provider: "github", status: "active", revision: "before" } }
      : channel === CHANNELS.connections.githubDeviceStart ? authorization
      : channel === CHANNELS.connections.getGithubRepos ? { repos: [{ id: 1, fullName: "owner/repo", private: false }] }
      : { revision: "saved", count: 1 };
    return { success: true, data };
  });
  setTransport({ kind: "fixture", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} });
  const store = configureStore({ reducer: { backends: backendsReducer, api: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
  const Wrapper = ({ children }: { children: ReactNode }) => <StrictMode><Provider store={store}>{children}</Provider></StrictMode>;
  const props = { open: true, onClose: vi.fn(), isConnected: false, onSuccess: vi.fn() };
  vi.stubGlobal("api", { shell: { openExternal: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  disposers.push(() => store.dispatch(baseApi.util.resetApiState()));
  const view = render(<GitHubModal {...props} />, { wrapper: Wrapper });
  return { invoke, finish, props, view };
}
afterEach(() => { cleanup(); for (const dispose of disposers.splice(0)) dispose(); resetTransport(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function authorize() {
  const start = await screen.findByRole("button", { name: /Sign in with GitHub/ });
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(start); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
}

it("uses the shared credential-save and repository-discovery tail for an authorized device", async () => {
  const f = fixture(); await authorize();
  await act(async () => { f.finish({ success: true, data: { status: "success", token: "device-token" } }); });
  expect(f.invoke).toHaveBeenCalledWith(CHANNELS.connections.saveCredentials, [expect.objectContaining({ provider: "github", connectionId: "conn", expectedRevision: "before", token: "device-token" })]);
  expect(f.invoke).toHaveBeenCalledWith(CHANNELS.connections.getGithubRepos, ["conn"]);
  expect(screen.getByText("owner/repo")).toBeDefined();
  expect(f.props.onSuccess).toHaveBeenCalledOnce();
});

it("does not deliver a late token after the wizard closes while its pane remains mounted", async () => {
  const f = fixture(); await authorize();
  fireEvent.click(screen.getByRole("button", { name: "Close wizard" }));
  expect(f.props.onClose).toHaveBeenCalledOnce();
  await act(async () => { f.finish({ success: true, data: { status: "success", token: "obsolete-token" } }); });
  expect(f.invoke.mock.calls.filter(([ch]) => ch === CHANNELS.connections.saveCredentials || ch === CHANNELS.connections.getGithubRepos)).toHaveLength(0);
  expect(f.props.onSuccess).not.toHaveBeenCalled();
  expect(screen.queryByText(authorization.userCode)).toBeNull();
});
