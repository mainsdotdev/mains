// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectorsUpdatedEvent } from "@mains/contracts/provider-connectors";
import { setTransport, resetTransport } from "@/lib/transport/registry";

const mocks = vi.hoisted(() => ({
  getPlugins: vi.fn(), readPlugin: vi.fn(), refetch: vi.fn(), open: vi.fn(), startOAuth: vi.fn(),
  install: vi.fn(), uninstall: vi.fn(), enable: vi.fn(), update: vi.fn(), success: vi.fn(), error: vi.fn(),
  listeners: new Set<(event: ProviderConnectorsUpdatedEvent) => void>(),
}));
vi.mock("@/lib/redux/api", () => ({
  useGetProviderPluginsQuery: mocks.getPlugins,
  useReadProviderPluginQuery: mocks.readPlugin,
  useInstallProviderPluginMutation: () => [mocks.install, {}],
  useUninstallProviderPluginMutation: () => [mocks.uninstall, {}],
  useSetProviderPluginEnabledMutation: () => [mocks.enable, {}],
  useUpdateProviderPluginMutation: () => [mocks.update, {}],
  useStartProviderConnectorOAuthMutation: () => [mocks.startOAuth, {}],
}));
vi.mock("../hooks/use-plugin-catalog", () => ({ usePluginCatalog: mocks.getPlugins }));
vi.mock("@/components/ui", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
  Heading2: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Heading3: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
  Body: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Muted: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  HorizontalFadeScroller: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Input: () => null,
  SegmentedTabs: () => null,
  Select: () => null,
  CopyButton: () => null,
  AsciiSpinner: () => null,
  toast: { error: mocks.error, success: mocks.success },
}));
import ProviderPlugins from "./provider-plugins";

const plugin = {
  id: "app-gmail@marketplace/path", name: "gmail",
  installed: true, enabled: true, source: { type: "remote", path: "" },
  interface: { displayName: "Gmail", capabilities: [], screenshots: [] },
};
const pluginData = { marketplaces: [{ name: "marketplace", path: null, plugins: [plugin] }] };

function RouteControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="location">{location.search}</output>
    <button onClick={() => navigate(-1)}>History back</button>
  </>;
}

beforeEach(() => {
  vi.clearAllMocks();
  setTransport({
    kind: "fixture", invoke: vi.fn(), status: () => "connected", onStatusChange: () => () => {},
    subscribe(_channel, listener) {
      mocks.listeners.add(listener);
      return () => { mocks.listeners.delete(listener); };
    },
  });
  mocks.refetch.mockReset();
  mocks.getPlugins.mockReturnValue({ data: pluginData, isLoading: false });
  mocks.readPlugin.mockReturnValue({ refetch: mocks.refetch });
  for (const mutation of [mocks.install, mocks.uninstall, mocks.enable, mocks.update]) {
    mutation.mockReturnValue({ unwrap: async () => {} });
  }
});
afterEach(() => { cleanup(); resetTransport(); mocks.listeners.clear(); });

describe("plugin detail navigation", () => {
  it("renders one shelf entry and card per plugin identity when marketplaces repeat entries", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getPlugins.mockReturnValue({ data: { ...pluginData, marketplaces: [
      pluginData.marketplaces[0],
      { ...pluginData.marketplaces[0], name: "duplicate-marketplace", plugins: [{ ...plugin }] },
    ] }, isLoading: false });
    try {
      const view = render(<MemoryRouter><ProviderPlugins providerId="codex" /></MemoryRouter>);
      expect(screen.getAllByRole("button", { name: "Open Gmail" })).toHaveLength(1);
      expect(screen.getAllByText("Gmail")).toHaveLength(1);
      view.rerender(<MemoryRouter><ProviderPlugins providerId="codex" /></MemoryRouter>);
      expect(screen.getAllByRole("button", { name: "Open Gmail" })).toHaveLength(1);
      expect(errors.mock.calls.some(([message]) => String(message).includes("same key"))).toBe(false);
    } finally { errors.mockRestore(); }
  });

  it("preserves a pending plugin's controls while another plugin finishes and navigation returns", async () => {
    let finish!: () => void;
    mocks.update.mockReturnValueOnce({ unwrap: () => new Promise<void>((resolve) => { finish = resolve; }) });
    const first = { ...plugin, source: { type: "local", path: "/market" }, updateAvailable: true };
    const second = { ...first, id: "calendar@market", name: "calendar", interface: { ...plugin.interface, displayName: "Calendar" } };
    mocks.getPlugins.mockReturnValue({ data: {
      ...pluginData, marketplaces: [{ ...pluginData.marketplaces[0], plugins: [first, second] }],
    }, isLoading: false });
    render(<MemoryRouter initialEntries={[`/plugins?plugin=${encodeURIComponent(plugin.id)}`]}>
      <ProviderPlugins providerId="claude_code" />
    </MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Calendar" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update" })); });
    fireEvent.click(screen.getByRole("button", { name: "Back to plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Gmail" }));
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(mocks.uninstall).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Disable" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    expect((screen.getByRole("button", { name: "Disable" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks every competing action while the selected plugin is updating", async () => {
    let finish!: () => void;
    mocks.update.mockReturnValue({ unwrap: () => new Promise<void>((resolve) => { finish = resolve; }) });
    mocks.getPlugins.mockReturnValue({ data: {
      ...pluginData, marketplaces: [{ ...pluginData.marketplaces[0], plugins: [{
        ...plugin, source: { type: "local", path: "/market" }, updateAvailable: true,
      }] }],
    }, isLoading: false });
    render(<MemoryRouter initialEntries={[`/plugins?plugin=${encodeURIComponent(plugin.id)}`]}>
      <ProviderPlugins providerId="claude_code" />
    </MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.enable).not.toHaveBeenCalled();
    expect(mocks.uninstall).not.toHaveBeenCalled();
    await act(async () => { finish(); });
  });

  it("refreshes the connection on returning from hosted setup and replaces Connect with Connected", async () => {
    const detail = {
      summary: plugin, skills: [], mcpServers: [], apps: [{
        id: "app-gmail", name: "Gmail", installed: true, runtimeEnabled: true, callable: false,
        installUrl: "https://chatgpt.com/apps/gmail", description: "Gmail app",
      }],
    };
    mocks.readPlugin.mockReturnValue({ data: detail, refetch: mocks.refetch });
    const previousApi = Object.getOwnPropertyDescriptor(window, "api");
    Object.defineProperty(window, "api", { configurable: true, value: { shell: { openExternal: mocks.open } } });
    try {
      const route = `/plugins?provider=codex&plugin=${encodeURIComponent(plugin.id)}`;
      const view = render(<MemoryRouter initialEntries={[route]}><ProviderPlugins providerId="codex" /></MemoryRouter>);
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(mocks.open).toHaveBeenCalledWith("https://chatgpt.com/apps/gmail");
      expect(screen.getByText("Needs setup")).toBeTruthy();
      mocks.refetch.mockImplementation(() => {
        mocks.readPlugin.mockReturnValue({
          data: { ...detail, apps: [{ ...detail.apps[0], callable: true }] }, refetch: mocks.refetch,
        });
        view.rerender(<MemoryRouter initialEntries={[route]}><ProviderPlugins providerId="codex" /></MemoryRouter>);
      });
      fireEvent.focus(window);
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Connected")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
      view.unmount();
      fireEvent.focus(window);
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
    } finally {
      if (previousApi) Object.defineProperty(window, "api", previousApi);
      else Reflect.deleteProperty(window, "api");
    }
  });

  it("opens the URL's exact plugin after the catalog loads and preserves other params on Back", () => {
    mocks.getPlugins.mockReturnValue({ isLoading: true });
    const initial = `/plugins?provider=codex&plugin=${encodeURIComponent(plugin.id)}`;
    const view = render(<MemoryRouter initialEntries={[initial]}>
      <ProviderPlugins providerId="codex" /><RouteControls />
    </MemoryRouter>);
    expect(screen.getByText(/Loading plugins/)).toBeTruthy();
    mocks.getPlugins.mockReturnValue({ data: pluginData, isLoading: false });
    view.rerender(<MemoryRouter initialEntries={[initial]}>
      <ProviderPlugins providerId="codex" /><RouteControls />
    </MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Gmail", level: 2 })).toBeTruthy();
    expect(mocks.readPlugin).toHaveBeenCalledWith(
      { providerId: "codex", pluginName: "gmail", marketplacePath: "" }, { skip: false, refetchOnMountOrArgChange: true },
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to plugins" }));
    expect(screen.queryByRole("heading", { name: "Gmail", level: 2 })).toBeNull();
    expect(screen.getByTestId("location").textContent).toBe("?provider=codex");
    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    expect(screen.getByRole("heading", { name: "Gmail", level: 2 })).toBeTruthy();
  });

  it("records a catalog selection in the URL while preserving settings navigation", () => {
    render(<MemoryRouter initialEntries={["/settings?section=codex-plugins"]}>
      <ProviderPlugins providerId="codex" /><RouteControls />
    </MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Open Gmail" }));
    expect(screen.getByRole("heading", { name: "Gmail", level: 2 })).toBeTruthy();
    const params = new URLSearchParams(screen.getByTestId("location").textContent!);
    expect(params.get("section")).toBe("codex-plugins");
    expect(params.get("plugin")).toBe(plugin.id);
  });
});
