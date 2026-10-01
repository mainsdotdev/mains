// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readResource: vi.fn(),
  callTool: vi.fn(),
  openUrl: vi.fn(),
  openExternal: vi.fn(),
  bridges: [] as Array<{
    onrequestdisplaymode?: (request: { mode: "inline" | "fullscreen" | "pip" }) => Promise<{ mode: string }>;
    oninitialized?: () => void;
    oncalltool?: (request: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
    onopenlink?: (request: { url: string }) => Promise<unknown>;
    capabilities: Record<string, unknown>;
    getAppCapabilities: ReturnType<typeof vi.fn>;
    setHostContext: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@/hooks/use-is-dark-mode", () => ({ useIsDarkMode: () => false }));
vi.mock("@/hooks/use-browser-panel", () => ({
  useBrowserPanel: () => ({ openUrl: mocks.openUrl }),
}));
vi.mock("@modelcontextprotocol/ext-apps/app-bridge", () => ({
  AppBridge: class {
    onrequestdisplaymode?: (request: { mode: "inline" | "fullscreen" | "pip" }) => Promise<{ mode: string }>;
    oninitialized?: () => void;
    getAppCapabilities = vi.fn();
    setHostContext = vi.fn();
    connect = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    sendToolInput = vi.fn().mockResolvedValue(undefined);
    sendToolResult = vi.fn().mockResolvedValue(undefined);
    capabilities: Record<string, unknown>;
    constructor(_client: unknown, _info: unknown, capabilities: Record<string, unknown>) {
      this.capabilities = capabilities;
      mocks.bridges.push(this);
    }
  },
  PostMessageTransport: class {},
  buildAllowAttribute: () => "",
}));

import { McpAppDisplay } from "./mcp-app-display";

const app = {
  server: "codex_apps",
  tool: "show_map",
  resourceUri: "ui://maps/results.html",
  originCallId: "call-1",
  connectorId: "maps",
  linkId: "account-2",
};

function renderApp(availableDisplayModes?: string[], preferredModelDisplayMode?: "inline" | "fullscreen") {
  mocks.readResource.mockResolvedValue({
    success: true,
    data: {
      url: "about:blank",
      mimeType: "text/html;profile=mcp-app",
      meta: { availableDisplayModes },
    },
  });
  render(createElement(McpAppDisplay, {
    runId: "run-1",
    app: { ...app, preferredModelDisplayMode },
    input: {},
    title: "Trip map",
  }));
}

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "0.12.0");
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      mcpApps: { readResource: mocks.readResource, callTool: mocks.callTool },
      shell: { openExternal: mocks.openExternal },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.bridges.length = 0;
});

describe("MCP App display modes", () => {
  it("hides the host Expand button until a widget opts into fullscreen", async () => {
    renderApp(undefined, "inline");
    await screen.findByTitle("Trip map interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const bridge = mocks.bridges[0];

    act(() => bridge.oninitialized?.());

    expect(screen.queryByRole("button", { name: "Expand Trip map" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("accepts a fullscreen request from a widget without a mode declaration", async () => {
    renderApp(undefined, "inline");
    await screen.findByTitle("Trip map interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const bridge = mocks.bridges[0];
    act(() => bridge.oninitialized?.());
    expect(screen.queryByRole("button", { name: "Expand Trip map" })).toBeNull();

    await act(async () => {
      expect(await bridge.onrequestdisplaymode?.({ mode: "fullscreen" }))
        .toEqual({ mode: "fullscreen" });
    });

    expect(screen.getByRole("dialog", { name: "Trip map interactive app" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Return to chat" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Trip map" })).toBeTruthy();
  });

  it("offers fullscreen after the widget announces support at initialization", async () => {
    renderApp();
    await screen.findByTitle("Trip map interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const bridge = mocks.bridges[0];
    bridge.getAppCapabilities.mockReturnValue({ availableDisplayModes: ["inline", "fullscreen"] });

    act(() => bridge.oninitialized?.());

    expect(screen.getByRole("button", { name: "Expand Trip map" })).toBeTruthy();
  });

  it("expands and returns to the conversation without replacing the iframe", async () => {
    renderApp(["inline", "fullscreen"]);
    const expand = await screen.findByRole("button", { name: "Expand Trip map" });
    const iframe = screen.getByTitle("Trip map interactive app");
    const user = userEvent.setup();
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    act(() => mocks.bridges[0].oninitialized?.());

    await user.click(expand);
    expect(screen.getByRole("dialog", { name: "Trip map interactive app" })).toBeTruthy();
    expect(screen.getByTitle("Trip map interactive app")).toBe(iframe);
    await waitFor(() => expect(mocks.bridges[0]?.setHostContext).toHaveBeenCalledWith(
      expect.objectContaining({ displayMode: "fullscreen" }),
    ));

    await user.click(screen.getByRole("button", { name: "Return to chat" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTitle("Trip map interactive app")).toBe(iframe);
    expect(document.activeElement).toBe(expand);
    expect(mocks.bridges).toHaveLength(1);
    expect(mocks.readResource).toHaveBeenCalledWith(expect.objectContaining({
      connectorId: "maps",
      linkId: "account-2",
    }));
  });

  it("honors a widget display-mode request and reports the actual mode", async () => {
    renderApp(["inline", "fullscreen"]);
    await screen.findByRole("button", { name: "Expand Trip map" });
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const bridge = mocks.bridges[0];

    await act(async () => {
      expect(await bridge.onrequestdisplaymode?.({ mode: "fullscreen" }))
        .toEqual({ mode: "fullscreen" });
    });
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => {
      expect(await bridge.onrequestdisplaymode?.({ mode: "pip" }))
        .toEqual({ mode: "fullscreen" });
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens a fullscreen-only widget directly and collapses it on close", async () => {
    renderApp(["fullscreen"], "fullscreen");
    await screen.findByRole("dialog", { name: "Trip map interactive app" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Return to chat" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Open app")).toBeTruthy();
    await userEvent.setup().click(screen.getByText("Open app"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("uses capabilities announced during initialization to limit app modes", async () => {
    renderApp(["inline", "fullscreen"], "fullscreen");
    await screen.findByRole("dialog", { name: "Trip map interactive app" });
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const bridge = mocks.bridges[0];
    const iframe = screen.getByTitle("Trip map interactive app");
    bridge.getAppCapabilities.mockReturnValue({ availableDisplayModes: ["inline"] });

    act(() => bridge.oninitialized?.());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTitle("Trip map interactive app")).toBe(iframe);
    expect(screen.queryByRole("button", { name: "Expand Trip map" })).toBeNull();
    expect(bridge.setHostContext).toHaveBeenCalledWith(expect.objectContaining({
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
    }));
    await act(async () => {
      expect(await bridge.onrequestdisplaymode?.({ mode: "fullscreen" }))
        .toEqual({ mode: "inline" });
    });
  });

  it("hosts a sidebar app as a page and routes tools through its session without advertising chat", async () => {
    mocks.readResource.mockResolvedValue({ success: true, data: {
      url: "about:blank", meta: { availableDisplayModes: ["fullscreen"] },
    } });
    mocks.callTool.mockResolvedValue({ success: true, data: { content: [] } });
    render(createElement(McpAppDisplay, {
      sessionId: "app-session", presentation: "page", app: { ...app, originCallId: undefined },
      unsupportedTools: { _dotcom_zero: "Live sync does not support this host" },
      input: {}, title: "tldraw",
    }));
    await screen.findByTitle("tldraw interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const bridge = mocks.bridges[0];
    act(() => bridge.oninitialized?.());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Return to chat" })).toBeNull();
    expect(bridge.capabilities.message).toBeUndefined();
    expect(bridge.setHostContext).toHaveBeenCalledWith(expect.objectContaining({
      displayMode: "fullscreen", availableDisplayModes: ["fullscreen"],
    }));
    await bridge.oncalltool?.({ name: "_dotcom_boards" });
    expect(mocks.callTool).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "app-session", tool: "_dotcom_boards" }));
    expect(await bridge.onrequestdisplaymode?.({ mode: "inline" })).toEqual({ mode: "fullscreen" });
    await bridge.onopenlink?.({ url: "https://www.tldraw.com/" });
    expect(mocks.openExternal).toHaveBeenCalledWith("https://www.tldraw.com/");
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(await bridge.oncalltool?.({ name: "_dotcom_zero" })).toEqual({
      isError: true, content: [{ type: "text", text: "Live sync does not support this host" }],
    });
    expect(mocks.callTool).toHaveBeenCalledTimes(1);
  });
});
