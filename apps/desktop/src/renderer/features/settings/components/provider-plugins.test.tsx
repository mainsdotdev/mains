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
vi.mock("@/components/ui", async (original) => ({
  ...await original<typeof import("@/components/ui")>(),
  Button: (props: ComponentProps<"button">) => <button {...props} />,
  Heading2: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Heading3: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
  Body: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Muted: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children, role, "aria-live": ariaLive }: ComponentProps<"span">) => <span role={role} aria-live={ariaLive}>{children}</span>,
  HorizontalFadeScroller: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
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
afterEach(() => { cleanup(); resetTransport(); mocks.listeners.clear(); vi.unstubAllGlobals(); });

function catalog(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...plugin, id: `plugin-${index + 1}@market`, name: `plugin-${index + 1}`, installed: false,
    interface: { ...plugin.interface, displayName: `Plugin ${index + 1}`, category: index < 40 ? "development" : "research" },
  }));
}

function showCatalog(plugins = catalog(55), featuredPluginIds: string[] = []) {
  mocks.getPlugins.mockReturnValue({ data: { ...pluginData, featuredPluginIds,
    marketplaces: [{ ...pluginData.marketplaces[0], plugins }] }, isLoading: false });
  return render(<MemoryRouter><ProviderPlugins providerId="codex" /></MemoryRouter>);
}

describe("plugin catalog rendering budget", () => {
  it("mounts one page of cards and replaces them when paging", () => {
    const { container } = showCatalog();
    expect(container.querySelectorAll('[role="button"]').length).toBe(24);
    expect(screen.getByText("Plugin 1")).toBeTruthy();
    expect(screen.queryByText("Plugin 25")).toBeNull();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(container.querySelectorAll('[role="button"]').length).toBe(24);
    expect(screen.queryByText("Plugin 1")).toBeNull();
    expect(screen.getByText("Plugin 25")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(container.querySelectorAll('[role="button"]').length).toBe(7);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Plugin 25")).toBeTruthy();
  });

  it("keeps a 12,000-plugin catalog bounded, including the featured rail", () => {
    const plugins = catalog(12_000);
    const { container } = showCatalog(plugins, plugins.map((item) => item.id));
    expect(container.querySelectorAll('[role="button"]').length).toBe(30);
    expect(screen.getByText("Plugin 1")).toBeTruthy();
    expect(screen.getByText("Plugin 30")).toBeTruthy();
    expect(screen.queryByText("Plugin 31")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("of 11994");
  });

  it("searches the full catalog and resets pagination when search is changed or cleared", () => {
    showCatalog();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search plugins" }), { target: { value: "Plugin 55" } });
    expect(screen.getByText("Plugin 55")).toBeTruthy();
    expect(screen.queryByText("Plugin 25")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Plugin pagination" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Plugin 1")).toBeTruthy();
    expect(screen.queryByText("Plugin 25")).toBeNull();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("filters categories across the catalog instead of only the visible page", () => {
    showCatalog();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("radio", { name: "Research" }));
    expect(screen.getByText("Plugin 41")).toBeTruthy();
    expect(screen.getByText("Plugin 55")).toBeTruthy();
    expect(screen.queryByText("Plugin 25")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Plugin pagination" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(screen.getByText("Plugin 1")).toBeTruthy();
  });

  it("returns from a plugin detail to the same catalog page", () => {
    showCatalog();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByText("Plugin 25").closest('[role="button"]')!);
    expect(screen.getByRole("heading", { name: "Plugin 25", level: 2 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to plugins" }));
    expect(screen.getByText("Plugin 25")).toBeTruthy();
    expect(screen.queryByText("Plugin 1")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Page 2 of 3");
  });

  it("clamps the page after catalog refresh and resets it for another provider", () => {
    const plugins = catalog(55);
    const view = showCatalog(plugins);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    mocks.getPlugins.mockReturnValue({ data: { ...pluginData,
      marketplaces: [{ ...pluginData.marketplaces[0], plugins: plugins.slice(0, 30) }] }, isLoading: false });
    view.rerender(<MemoryRouter><ProviderPlugins providerId="codex" /></MemoryRouter>);
    expect(screen.getByText("Plugin 25")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Page 2 of 2");
    view.rerender(<MemoryRouter><ProviderPlugins providerId="claude_code" /></MemoryRouter>);
    expect(screen.getByText("Plugin 1")).toBeTruthy();
    expect(screen.queryByText("Plugin 25")).toBeNull();
  });
});

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
