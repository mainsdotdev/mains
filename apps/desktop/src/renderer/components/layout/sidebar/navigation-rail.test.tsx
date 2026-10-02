// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";

const mocks = vi.hoisted(() => ({ openGlobal: vi.fn() }));
const app: McpAppEntrypoint = {
  id: "magicpath/account-1", name: "MagicPath", server: "codex_apps", tool: "magicpath.open_canvas",
  resourceUri: "ui://magicpath/canvas", entrypoints: ["global"], preferredModelDisplayMode: "fullscreen",
};
vi.mock("@/hooks/use-app-theme", () => ({
  useResolvedAppTheme: () => ({ light: { translucent: false }, dark: { translucent: false } }),
}));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({ useKeyboardShortcutBinding: () => null }));
vi.mock("@/hooks/use-mcp-app-extensions", () => ({
  useMcpAppExtensions: () => ({ available: true, entries: [app], isLoading: false }),
}));
vi.mock("@/hooks/use-mcp-app-panel", () => ({
  useMcpAppPanel: () => ({ openGlobal: mocks.openGlobal, opening: app.id, isOpen: false }),
}));
vi.mock("./mcp-app-icon", () => ({ McpAppIcon: () => <span data-testid="app-logo" /> }));
import { NavigationRail } from "./navigation-rail";
import McpAppPage from "@/routes/McpApp";

afterEach(cleanup);

describe("rail app navigation", () => {
  it("opens the loading page immediately while keeping its logo and navigation available", () => {
    mocks.openGlobal.mockReturnValue(new Promise<void>(() => {}));
    render(<MemoryRouter initialEntries={["/code/ws-1"]}>
      <NavigationRail showTasks={false} pluginsAvailable spaces={[]} activeSpaceId={null}
        onHomeClick={vi.fn()} onSpaceChange={vi.fn()} onSettingsClick={vi.fn()} onHelpClick={vi.fn()} helpMenuOpen={false} />
      <Routes>
        <Route path="/code/:workspaceId" element={<div>Conversation</div>} />
        <Route path="/apps/:appId" element={<McpAppPage />} />
        <Route path="/plugins" element={<div>Plugins page</div>} />
      </Routes>
    </MemoryRouter>);
    const appButton = screen.getByRole("button", { name: "MagicPath" }) as HTMLButtonElement;
    fireEvent.click(appButton);
    expect(screen.queryByText("Conversation")).toBeNull();
    expect(screen.getByRole("heading", { name: "MagicPath" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Opening MagicPath…");
    expect(mocks.openGlobal).toHaveBeenCalledWith(app);
    expect(appButton.getAttribute("aria-current")).toBe("page");
    expect(appButton.disabled).toBe(false);
    expect(appButton.querySelector('[data-testid="app-logo"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByText("Plugins page")).toBeTruthy();
  });
});
