// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { mcpAppPath } from "@/lib/mcp-app-extensions";
const mocks = vi.hoisted(() => ({ entries: [] as McpAppEntrypoint[], openGlobal: vi.fn() }));
vi.mock("@/hooks/use-mcp-app-extensions", () => ({ useMcpAppExtensions: () => ({ available: true, entries: mocks.entries, isLoading: false }) }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppPanel: () => ({ openGlobal: mocks.openGlobal }) }));
import McpAppPage from "./McpApp";
function entry(id: string): McpAppEntrypoint { return { id, name: "Canvas", server: "codex_apps", tool: "canvas.home", resourceUri: "ui://canvas",
  entrypoints: ["global"], preferredModelDisplayMode: "fullscreen" }; }
function tree(id: string) { return createElement(MemoryRouter, { initialEntries: [mcpAppPath({ id })] },
  createElement(Routes, null, createElement(Route, { path: "/apps/:appId", element: createElement(McpAppPage) }))); }
beforeEach(() => { vi.clearAllMocks(); mocks.entries = [entry("canvas")]; mocks.openGlobal.mockResolvedValue(undefined); });
afterEach(cleanup);
describe("MCP App deep links", () => {
  it("launches the shared panel instead of owning a second document", async () => {
    render(tree("canvas"));
    await waitFor(() => expect(mocks.openGlobal).toHaveBeenCalledWith(mocks.entries[0]));
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("keeps the launch across inventory metadata refreshes", async () => {
    const page = render(tree("canvas"));
    await waitFor(() => expect(mocks.openGlobal).toHaveBeenCalledOnce());
    mocks.entries = [{ ...entry("canvas"), icons: [{ src: "https://example.com/icon.svg" }] }];
    page.rerender(tree("canvas"));
    expect(mocks.openGlobal).toHaveBeenCalledOnce();
  });
  it("explains unavailable plugins", () => {
    render(tree("missing"));
    expect(screen.getByRole("alert").textContent).toContain("no longer available");
    expect(mocks.openGlobal).not.toHaveBeenCalled();
  });
  it("preserves the full encoded connector/account identity", async () => {
    const id = JSON.stringify(["server", "canvas.home", "connector/1", "account %2F /"]);
    mocks.entries = [entry(id)];
    render(tree(id));
    await waitFor(() => expect(mocks.openGlobal).toHaveBeenCalledWith(mocks.entries[0]));
  });
});
