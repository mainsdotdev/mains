// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPlugins: vi.fn(), readPlugin: vi.fn() }));
vi.mock("@/lib/redux/api", () => ({
  useGetProviderPluginsQuery: mocks.getPlugins,
  useReadProviderPluginQuery: mocks.readPlugin,
  useInstallProviderPluginMutation: () => [vi.fn(), {}],
  useUninstallProviderPluginMutation: () => [vi.fn(), {}],
  useSetProviderPluginEnabledMutation: () => [vi.fn(), {}],
  useUpdateProviderPluginMutation: () => [vi.fn(), {}],
  useStartProviderConnectorOAuthMutation: () => [vi.fn(), {}],
}));
vi.mock("@/lib/transport/events", () => ({
  appEvents: { providers: { onConnectorsUpdated: () => () => {} } },
}));
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
  toast: { error: vi.fn() },
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
  mocks.getPlugins.mockReturnValue({ data: pluginData, isLoading: false });
  mocks.readPlugin.mockReturnValue({ refetch: vi.fn() });
});
afterEach(cleanup);

describe("plugin detail navigation", () => {
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
      { providerId: "codex", pluginName: "gmail", marketplacePath: "" }, { skip: false },
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
