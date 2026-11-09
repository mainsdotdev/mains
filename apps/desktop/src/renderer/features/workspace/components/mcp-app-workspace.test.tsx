// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";

const mocks = vi.hoisted(() => ({ app: undefined as McpAppEntrypoint | undefined, display: vi.fn() }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppPanel: () => ({
  document: { app: mocks.app }, scope: { providerId: "codex" },
}) }));
vi.mock("./tools/mcp-app-display", () => ({ McpAppDisplay: () => { mocks.display(); return <iframe title="App" />; } }));
import { McpAppWorkspace } from "./mcp-app-workspace";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("tool-originated app launch notices", () => {
  it.each([
    { name: "Notion", tool: "notion.notion-page-panel", linkId: "account-1", action: "Open in browser" },
    { name: "Canva", tool: "canva.openai-home", linkId: "synthetic_link::canva", action: "Reconnect Canva" },
  ])("prevents $name from loading an unavailable iframe", ({ action, ...metadata }) => {
    mocks.app = { ...metadata, id: metadata.name, server: "codex_apps", resourceUri: "ui://app",
      entrypoints: ["thread"], preferredModelDisplayMode: "fullscreen" };
    render(<MemoryRouter><McpAppWorkspace /></MemoryRouter>);
    expect(screen.getByRole("button", { name: action })).toBeTruthy();
    expect(mocks.display).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
