// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readResource: vi.fn(),
  callTool: vi.fn(),
  sendMessage: vi.fn(),
  openUrl: vi.fn(),
  openExternal: vi.fn(),
  bridges: [] as Array<{
    onrequestdisplaymode?: (request: { mode: "inline" | "fullscreen" | "pip" }) => Promise<{ mode: string }>;
    oninitialized?: () => void;
    oncalltool?: (request: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
    onopenlink?: (request: { url: string }) => Promise<unknown>;
    onmessage?: (request: { content: unknown; _meta?: Record<string, unknown> }, extra?: { signal: AbortSignal }) => Promise<unknown>;
    onupdatemodelcontext?: (context: unknown) => Promise<unknown>;
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    capabilities: Record<string, unknown>;
    getAppCapabilities: ReturnType<typeof vi.fn>;
    setHostContext: ReturnType<typeof vi.fn>;
  }>,
}));

type MessageRequest = { params: { content: unknown; _meta?: unknown } };

vi.mock("@/hooks/use-is-dark-mode", () => ({ useIsDarkMode: () => false }));
vi.mock("@/hooks/use-browser-panel", () => ({
  useBrowserPanel: () => ({ openUrl: mocks.openUrl }),
}));
vi.mock("@modelcontextprotocol/ext-apps/app-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@modelcontextprotocol/ext-apps/app-bridge")>()),
  AppBridge: class {
    onrequestdisplaymode?: (request: { mode: "inline" | "fullscreen" | "pip" }) => Promise<{ mode: string }>;
    oninitialized?: () => void;
    getAppCapabilities = vi.fn();
    setHostContext = vi.fn();
    connect = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    sendToolInput = vi.fn().mockResolvedValue(undefined);
    sendToolResult = vi.fn().mockResolvedValue(undefined);
    onmessage?: (request: { content: unknown; _meta?: Record<string, unknown> }, extra?: { signal: AbortSignal }) => Promise<unknown>;
    replaceRequestHandler = vi.fn((schema: { parse: (value: unknown) => MessageRequest }, handler: (request: MessageRequest, extra: { signal: AbortSignal }) => Promise<unknown>) => {
      this.onmessage = (params, extra) => handler(schema.parse({ method: "ui/message", params: { role: "user", ...params } }), extra ?? { signal: new AbortController().signal });
    });
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
      mcpApps: { readResource: mocks.readResource, callTool: mocks.callTool, sendMessage: mocks.sendMessage },
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
  it("starts the bridge when an initially unavailable iframe browsing context becomes ready", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow")!.get!;
    let ready = false;
    const getter = vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockImplementation(function (this: HTMLIFrameElement) {
      return ready ? original.call(this) : null;
    });
    mocks.readResource.mockResolvedValue({ success: true, data: { url: "about:blank", meta: { availableDisplayModes: ["inline", "fullscreen"] } } });
    const props = { sessionId: "app-session", presentation: "page" as const, panelDisplayMode: "fullscreen" as const,
      app, input: {}, title: "MagicPath", isActive: false };
    const view = render(createElement(McpAppDisplay, props));
    try {
      await waitFor(() => expect(screen.queryByText("Loading app…")).toBeNull());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(mocks.bridges).toHaveLength(1);
      expect(mocks.bridges[0].connect).not.toHaveBeenCalled();
      ready = true;
      view.rerender(createElement(McpAppDisplay, { ...props, isActive: true }));
      fireEvent.load(screen.getByTitle("MagicPath interactive app"));
      await waitFor(() => expect(mocks.bridges).toHaveLength(1));
      await waitFor(() => expect(mocks.bridges[0].connect).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.getByTitle("MagicPath interactive app").getAttribute("src")).toBe("about:blank"));
      view.rerender(createElement(McpAppDisplay, { ...props, isActive: false }));
      view.rerender(createElement(McpAppDisplay, { ...props, isActive: true }));
      expect(mocks.bridges).toHaveLength(1);
      expect(mocks.bridges[0].close).not.toHaveBeenCalled();
    } finally { getter.mockRestore(); }
  });

  it.each(["timeout", "unmount"])("ends iframe readiness waiting on %s", async (end) => {
    vi.useFakeTimers();
    const getter = vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue(null);
    mocks.readResource.mockResolvedValue({ success: true, data: { url: "about:blank", meta: { availableDisplayModes: ["fullscreen"] } } });
    const view = render(createElement(McpAppDisplay, { sessionId: "app-session", presentation: "page", app, input: {}, title: "MagicPath" }));
    try {
      await act(async () => { await Promise.resolve(); });
      expect(mocks.bridges).toHaveLength(1);
      expect(mocks.bridges[0].connect).not.toHaveBeenCalled();
      if (end === "unmount") view.unmount();
      act(() => vi.advanceTimersByTime(10_000));
      if (end === "timeout") expect(screen.getByText(/The app frame could not start/)).toBeTruthy();
      else expect(mocks.bridges[0].close).toHaveBeenCalledOnce();
      expect(mocks.bridges[0].connect).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { view.unmount(); getter.mockRestore(); vi.useRealTimers(); }
  });

  it("keeps a tool-opened canvas connected through panel changes and resolves its bare UI tools", async () => {
    mocks.readResource.mockResolvedValue({ success: true, data: { url: "about:blank", meta: { availableDisplayModes: ["inline", "fullscreen"] } } });
    mocks.callTool.mockResolvedValue({ success: true, data: { content: [] } });
    const changeMode = vi.fn();
    const props = { resourceRunId: "source-run", runId: "source-run", presentation: "page" as const,
      panelDisplayMode: "inline" as const, onDisplayModeChange: changeMode, onMessage: vi.fn(),
      app: { ...app, tool: "magicpath.open_magicpath_canvas", resourceUri: "ui://magicpath/canvas" }, input: {}, title: "MagicPath" };
    const view = render(createElement(McpAppDisplay, props));
    const iframe = await screen.findByTitle("MagicPath interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const bridge = mocks.bridges[0];
    act(() => bridge.oninitialized?.());
    await bridge.oncalltool?.({ name: "create_canvas_app_session", arguments: { projectId: "existing-project" } });
    expect(mocks.callTool).toHaveBeenLastCalledWith(expect.objectContaining({ runId: "source-run",
      tool: "magicpath.create_canvas_app_session", arguments: { projectId: "existing-project" } }));
    await act(async () => { expect(await bridge.onrequestdisplaymode?.({ mode: "fullscreen" })).toEqual({ mode: "fullscreen" }); });
    expect(changeMode).toHaveBeenCalledWith("fullscreen");
    view.rerender(createElement(McpAppDisplay, { ...props, runId: "next-chat", panelDisplayMode: "fullscreen" }));
    await bridge.oncalltool?.({ name: "create_canvas_app_session" });
    expect(mocks.callTool).toHaveBeenLastCalledWith(expect.objectContaining({ runId: "source-run", tool: "magicpath.create_canvas_app_session" }));
    expect(screen.getByTitle("MagicPath interactive app")).toBe(iframe);
    expect(mocks.readResource).toHaveBeenCalledTimes(1);
    expect(mocks.bridges).toHaveLength(1);
    expect(bridge.close).not.toHaveBeenCalled();
  });

  it("keeps the app document connected when its draft becomes a real conversation", async () => {
    mocks.readResource.mockResolvedValue({ success: true, data: { url: "about:blank", meta: { availableDisplayModes: ["fullscreen"] } } });
    mocks.callTool.mockResolvedValue({ success: true, data: { content: [] } });
    const firstMessage = vi.fn().mockResolvedValue(undefined);
    const nextMessage = vi.fn().mockResolvedValue(undefined);
    const updateContext = vi.fn().mockResolvedValue({ updateId: "update-1", content: [{ type: "text", text: "Canvas 1" }] });
    const props = { sessionId: "app-session", presentation: "page" as const,
      app: { ...app, originCallId: undefined }, input: {}, title: "MagicPath",
      onMessage: firstMessage, onModelContextChange: updateContext, modelContext: null };
    const page = render(createElement(McpAppDisplay, props));
    const iframe = await screen.findByTitle("MagicPath interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const bridge = mocks.bridges[0];
    act(() => bridge.oninitialized?.());
    expect(bridge.capabilities.message).toEqual({ text: {} });
    expect(bridge.capabilities.experimental).toEqual({ "openai/modelContext": {}, "openai/message": {} });
    let firstSend!: Promise<unknown>;
    act(() => { firstSend = bridge.onmessage!({ content: [{ type: "text", text: "Start from the canvas" }] }); });
    expect(firstMessage).not.toHaveBeenCalled();
    expect((await screen.findByRole("textbox", { name: "App prompt" }) as HTMLTextAreaElement).value).toBe("Start from the canvas");
    await userEvent.setup().click(screen.getByRole("button", { name: "Send" }));
    await firstSend;
    expect(firstMessage).toHaveBeenCalledWith([{ type: "text", text: "Start from the canvas" }], {});
    // The browser callback changes with the composer owner, too.
    mocks.openUrl = vi.fn();
    page.rerender(createElement(McpAppDisplay, { ...props, runId: "real-run", onMessage: nextMessage,
      modelContext: { updateId: "update-1", content: [{ type: "text" as const, text: "Canvas 1" }] } }));
    expect(screen.getByTitle("MagicPath interactive app")).toBe(iframe);
    expect(mocks.bridges).toHaveLength(1);
    expect(bridge.close).not.toHaveBeenCalled();
    expect(mocks.readResource).toHaveBeenCalledTimes(1);
    let nextSend!: Promise<unknown>;
    act(() => { nextSend = bridge.onmessage!({ content: [{ type: "text", text: "Another idea" }], _meta: { "openai/message": { target: "new" } } }); });
    const user = userEvent.setup();
    const editor = await screen.findByRole("textbox", { name: "App prompt" });
    expect(nextMessage).not.toHaveBeenCalled();
    expect(screen.getByText("This will start a new chat.")).toBeTruthy();
    await user.clear(editor);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(editor, "My edited idea");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await nextSend;
    expect(nextMessage).toHaveBeenCalledWith([{ type: "text", text: "My edited idea" }], { target: "new" });
    await bridge.oncalltool?.({ name: "show_map" });
    expect(mocks.callTool).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "app-session", runId: "real-run" }));
    expect(await bridge.onupdatemodelcontext?.({ content: [{ type: "text", text: "Canvas 1" }] }))
      .toEqual({ _meta: { "openai/modelContext": { updateId: "update-1" } } });
    page.rerender(createElement(McpAppDisplay, { ...props, runId: "real-run", onMessage: nextMessage, modelContext: null }));
    expect(bridge.setHostContext).toHaveBeenLastCalledWith(expect.objectContaining({
      "openai/modelContext": null, displayMode: "fullscreen", toolInfo: expect.any(Object),
    }));
    expect(mocks.bridges).toHaveLength(1);
  });

  it("reports a failed UI message instead of acknowledging it as sent", async () => {
    mocks.readResource.mockResolvedValue({ success: true, data: { url: "about:blank", meta: { availableDisplayModes: ["fullscreen"] } } });
    render(createElement(McpAppDisplay, { sessionId: "app-session", presentation: "page", app, input: {}, title: "Canvas",
      onMessage: vi.fn().mockRejectedValue(new Error("Wait for the current response")) }));
    await screen.findByTitle("Canvas interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    let sent!: Promise<unknown>;
    act(() => { sent = mocks.bridges[0].onmessage!({ content: [{ type: "text", text: "Next" }] }); });
    const rejected = expect(sent).rejects.toThrow("Wait for the current response");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Send" }));
    await rejected;
  });

  it.each(["Cancel", "Escape", "Close"])("sends nothing when the user dismisses the preview with %s", async (dismiss) => {
    mocks.readResource.mockResolvedValue({ success: true, data: { url: "about:blank", meta: { availableDisplayModes: ["fullscreen"] } } });
    const onMessage = vi.fn();
    render(createElement(McpAppDisplay, { sessionId: "app-session", presentation: "page", app, input: {}, title: "Canva", onMessage }));
    await screen.findByTitle("Canva interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    let sent!: Promise<unknown>;
    act(() => { sent = mocks.bridges[0].onmessage!({ content: [{ type: "text", text: "Design a presentation" }] }); });
    const editor = await screen.findByRole("textbox", { name: "App prompt" });
    expect(document.activeElement).toBe(editor);
    const user = userEvent.setup();
    if (dismiss === "Escape") await user.keyboard("{Escape}");
    else await user.click(screen.getByRole("button", { name: dismiss === "Close" ? "Cancel app prompt" : "Cancel" }));
    expect(await sent).toEqual({ isError: true });
    expect(onMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.bridges[0].close).not.toHaveBeenCalled();
  });

  it("cancels pending previews on RPC abort or navigation and rejects overlapping app requests", async () => {
    mocks.readResource.mockResolvedValue({ success: true, data: { url: "about:blank", meta: { availableDisplayModes: ["fullscreen"] } } });
    const onMessage = vi.fn();
    const page = render(createElement(McpAppDisplay, { sessionId: "app-session", presentation: "page", app, input: {}, title: "Canva", onMessage }));
    await screen.findByTitle("Canva interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const bridge = mocks.bridges[0];
    const controller = new AbortController();
    const request = { content: [{ type: "text", text: "Review this" }] };
    let sent!: Promise<unknown>;
    act(() => { sent = bridge.onmessage!(request, { signal: controller.signal }); });
    await screen.findByRole("textbox", { name: "App prompt" });
    await expect(bridge.onmessage!(request)).rejects.toThrow("current prompt first");
    act(() => controller.abort());
    expect(await sent).toEqual({ isError: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { sent = bridge.onmessage!(request); });
    await screen.findByRole("textbox", { name: "App prompt" });
    page.unmount();
    expect(await sent).toEqual({ isError: true });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("reviews legacy app messages through the same editable dialog", async () => {
    mocks.readResource.mockResolvedValue({ success: true, data: { url: "about:blank", meta: { availableDisplayModes: ["fullscreen"] } } });
    const onMessage = vi.fn().mockResolvedValue(undefined);
    render(createElement(McpAppDisplay, { sessionId: "app-session", presentation: "page", app, input: {}, title: "Canva", onMessage }));
    const iframe = await screen.findByTitle("Canva interactive app") as HTMLIFrameElement;
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    const response = vi.spyOn(iframe.contentWindow!, "postMessage");
    act(() => window.dispatchEvent(new MessageEvent("message", {
      source: iframe.contentWindow, data: { type: "mains:mcp-app-request", id: 12, method: "ui/message",
        params: { content: [{ type: "text", text: "Original" }], _meta: { "openai/message": { target: "new" } } } },
    })));
    expect(onMessage).not.toHaveBeenCalled();
    const user = userEvent.setup();
    const editor = await screen.findByRole("textbox", { name: "App prompt" });
    await user.clear(editor);
    await user.type(editor, "Edited from the app");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith([{ type: "text", text: "Edited from the app" }], { target: "new" }));
    expect(response).toHaveBeenCalledWith({ type: "mains:mcp-app-response", id: 12, result: {} }, "*");
  });

  it("also reviews messages from an inline app before using the run's IPC path", async () => {
    mocks.sendMessage.mockResolvedValue({ success: true, data: {} });
    renderApp();
    await screen.findByTitle("Trip map interactive app");
    await waitFor(() => expect(mocks.bridges).toHaveLength(1));
    let sent!: Promise<unknown>;
    act(() => { sent = mocks.bridges[0].onmessage!({ content: [{ type: "text", text: "Review the map" }] }); });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Send" }));
    expect(await sent).toEqual({});
    expect(mocks.sendMessage).toHaveBeenCalledWith({ runId: "run-1", content: [{ type: "text", text: "Review the map" }], modelContext: undefined });
  });

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
