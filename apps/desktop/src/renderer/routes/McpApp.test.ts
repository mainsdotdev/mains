// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint, OpenMcpAppExtensionResponse } from "@mains/contracts/mcp-apps";
import { mcpAppPath } from "@/lib/mcp-app-extensions";

const mocks = vi.hoisted(() => ({
  entries: [] as McpAppEntrypoint[], openExtension: vi.fn(), closeExtension: vi.fn(), refetch: vi.fn(),
}));
vi.mock("@/hooks/use-mcp-app-extensions", () => ({ useMcpAppExtensions: () => ({
  available: true, entries: mocks.entries, isLoading: false, refetch: mocks.refetch,
}) }));
vi.mock("@/hooks/use-space-provider-variant", () => ({ useSpaceProviderVariant: () => ({ providerId: "codex" }) }));
vi.mock("@/features/workspace/components/tools/mcp-app-display", () => ({
  McpAppDisplay: ({ title, sessionId }: { title: string; sessionId: string }) =>
    createElement("div", { "data-testid": "app-document" }, `${title}:${sessionId}`),
}));

import McpAppPage from "./McpApp";

function entry(id: string): McpAppEntrypoint {
  return { id, name: id === "magicpath" ? "MagicPath" : id, server: "codex_apps", tool: `${id}.home`,
    resourceUri: `ui://${id}/app.html`, entrypoints: ["global"], preferredModelDisplayMode: "fullscreen" };
}
function opened(id: string): OpenMcpAppExtensionResponse {
  return { sessionId: `session-${id}`, app: entry(id), output: { content: [] } };
}
function SwitchApp() {
  const navigate = useNavigate();
  return createElement("button", { onClick: () => navigate(mcpAppPath(entry("magicpath"))) }, "Switch app");
}
function pageTree(id: string) {
  return createElement(MemoryRouter, { initialEntries: [mcpAppPath({ id })] },
    createElement(SwitchApp),
    createElement(Routes, null, createElement(Route, { path: "/apps/:appId", element: createElement(McpAppPage) })),
  );
}
function renderPage(id: string) {
  return render(pageTree(id));
}

beforeEach(() => {
  mocks.entries = [entry("tldraw"), entry("magicpath")];
  mocks.openExtension.mockImplementation(async ({ entrypointId }) => ({ success: true, data: opened(entrypointId) }));
  mocks.closeExtension.mockResolvedValue({ success: true });
  Object.defineProperty(window, "api", { configurable: true, value: { mcpApps: mocks, shell: { openExternal: vi.fn() } } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("standalone MCP App routes", () => {
  it("opens a discovered entrypoint and releases its session when the page closes", async () => {
    const page = renderPage("magicpath");
    expect(await screen.findByTestId("app-document")).toHaveProperty("textContent", "MagicPath:session-magicpath");
    expect(mocks.openExtension).toHaveBeenCalledWith({ providerId: "codex", entrypointId: "magicpath" });
    expect(screen.queryByRole("note")).toBeNull();
    page.unmount();
    expect(mocks.closeExtension).toHaveBeenCalledWith({ sessionId: "session-magicpath" });
  });

  it("closes a late opening session after switching apps without replacing the current document", async () => {
    let resolveTldraw!: (value: unknown) => void;
    mocks.openExtension.mockImplementation(({ entrypointId }) => entrypointId === "tldraw"
      ? new Promise((resolve) => { resolveTldraw = resolve; })
      : Promise.resolve({ success: true, data: opened("magicpath") }));
    renderPage("tldraw");
    await waitFor(() => expect(mocks.openExtension).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Switch app" }));
    await screen.findByTestId("app-document");
    await act(async () => resolveTldraw({ success: true, data: opened("tldraw") }));
    expect(mocks.closeExtension).toHaveBeenCalledWith({ sessionId: "session-tldraw" });
    expect(screen.getByTestId("app-document").textContent).toBe("MagicPath:session-magicpath");
  });

  it("explains an unavailable plugin instead of opening an unrelated entrypoint", async () => {
    mocks.entries = [entry("tldraw")];
    renderPage("magicpath");
    expect((await screen.findByRole("alert")).textContent).toContain("no longer available");
    expect(mocks.openExtension).not.toHaveBeenCalled();
  });

  it("opens arbitrary plugins by their complete encoded account identity", async () => {
    const id = JSON.stringify(["custom-server", "custom.home", "connector/1", "account %2F /"]);
    mocks.entries = [{ ...entry(id), name: "Custom Canvas" }];
    renderPage(id);
    expect((await screen.findByTestId("app-document")).textContent).toBe(`Custom Canvas:session-${id}`);
    expect(mocks.openExtension).toHaveBeenCalledWith({ providerId: "codex", entrypointId: id });
  });

  it("keeps a session across metadata refreshes and closes it when its plugin disappears", async () => {
    const page = renderPage("magicpath");
    await screen.findByTestId("app-document");
    mocks.entries = [{ ...entry("magicpath"), icons: [{ src: "https://example.com/icon.svg" }] }];
    page.rerender(pageTree("magicpath"));
    expect(mocks.openExtension).toHaveBeenCalledTimes(1);
    mocks.entries = [];
    page.rerender(pageTree("magicpath"));
    expect(mocks.closeExtension).toHaveBeenCalledWith({ sessionId: "session-magicpath" });
    expect(screen.queryByTestId("app-document")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("no longer available");
  });
});
