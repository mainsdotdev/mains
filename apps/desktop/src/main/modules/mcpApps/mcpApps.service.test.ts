import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@mains/backend/modules/bridge", () => ({ assertOwnedRecord: vi.fn() }));

const harness = vi.hoisted(() => ({
  findRunById: vi.fn(),
  getProviderById: vi.fn(),
  readResource: vi.fn(),
  callTool: vi.fn(),
  continueRun: vi.fn(),
  registerDocument: vi.fn(),
  removeDocument: vi.fn(),
  openSession: vi.fn(),
  closeSession: vi.fn(),
  callSessionTool: vi.fn(),
  createAdapter: vi.fn(),
}));

vi.mock("@mains/backend/modules/runs", () => ({
  runsService: {
    getRunById: harness.findRunById,
    continueRun: harness.continueRun,
  },
}));
vi.mock("@mains/backend/modules/providers", () => ({
  providersService: { getById: harness.getProviderById },
  createWorkAdapter: harness.createAdapter,
}));
vi.mock("./mcpApps.registry", () => ({
  mcpAppsRegistry: { register: harness.registerDocument, remove: harness.removeDocument },
}));

import { mcpAppsService } from "./mcpApps.service";

describe("mcpAppsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.createAdapter.mockReturnValue({ readMcpAppResource: harness.readResource, callMcpAppTool: harness.callTool,
      openMcpAppSession: harness.openSession, closeMcpAppSession: harness.closeSession, callMcpAppSessionTool: harness.callSessionTool });
    harness.closeSession.mockResolvedValue(undefined);
    harness.findRunById.mockResolvedValue({
      id: "run-1",
      accountId: "account-1",
      providerId: "codex",
    });
    harness.getProviderById.mockResolvedValue({
      id: "codex",
      displayName: "Codex",
      kind: "agent_runtime",
      isEnabled: true,
      config: {},
    });
    harness.registerDocument.mockReturnValue(
      "mains-mcp-app://resource/token/index.html",
    );
  });

  it("reads app HTML and normalizes standard plus compatibility resource metadata", async () => {
    harness.readResource.mockResolvedValue({
      contents: [{
        uri: "ui://widgets/flights.html",
        mimeType: "text/html;profile=mcp-app",
        text: "<main>Flights</main>",
        _meta: {
          "openai/widgetCSP": {
            connect_domains: ["https://api.example.com"],
            resource_domains: ["https://cdn.example.com"],
          },
          "openai/widgetPrefersBorder": false,
          "openai/ui": {
            availableDisplayModes: ["fullscreen", "pip"],
          },
        },
      }],
      originCallId: "call-1",
    });

    const result = await mcpAppsService.readResource({
      runId: "run-1",
      server: "codex_apps",
      resourceUri: "ui://widgets/flights.html",
      originCallId: "call-1",
      connectorId: "skyscanner",
      linkId: "linked-account-2",
    });

    expect(harness.readResource).toHaveBeenCalledWith({
      runId: "run-1",
      server: "codex_apps",
      uri: "ui://widgets/flights.html",
      originCallId: "call-1",
      connectorId: "skyscanner",
      linkId: "linked-account-2",
    });
    expect(harness.registerDocument).toHaveBeenCalledWith(
      "<main>Flights</main>",
      {
        csp: {
          connectDomains: ["https://api.example.com"],
          resourceDomains: ["https://cdn.example.com"],
          frameDomains: undefined,
          baseUriDomains: undefined,
        },
        prefersBorder: false,
        availableDisplayModes: ["fullscreen"],
      },
    );
    expect(result.url).toBe("mains-mcp-app://resource/token/index.html");
    expect(result.meta.availableDisplayModes).toEqual(["fullscreen"]);
  });

  it("accepts the legacy ChatGPT Apps HTML media type", async () => {
    harness.readResource.mockResolvedValue({
      contents: [{
        uri: "ui://widgets/flights.html",
        mimeType: "text/html+skybridge",
        text: "<main>Flights</main>",
      }],
      originCallId: "call-1",
    });

    await expect(
      mcpAppsService.readResource({
        runId: "run-1",
        server: "codex_apps",
        resourceUri: "ui://widgets/flights.html",
      }),
    ).resolves.toMatchObject({ mimeType: "text/html+skybridge" });
  });

  it("forwards interactive tool calls through the run adapter", async () => {
    harness.callTool.mockResolvedValue({
      content: [{ type: "text", text: "selected" }],
      structuredContent: { selected: "flight-1" },
    });

    await expect(
      mcpAppsService.callTool({
        runId: "run-1",
        server: "codex_apps",
        tool: "select-flight",
        arguments: { id: "flight-1" },
      }),
    ).resolves.toMatchObject({ structuredContent: { selected: "flight-1" } });
    expect(harness.callTool).toHaveBeenCalledWith({
      runId: "run-1",
      server: "codex_apps",
      tool: "select-flight",
      arguments: { id: "flight-1" },
      meta: undefined,
    });
  });

  it("rejects non-app resources before invoking the provider", async () => {
    await expect(
      mcpAppsService.readResource({
        runId: "run-1",
        server: "codex_apps",
        resourceUri: "https://example.com/widget.html",
      }),
    ).rejects.toThrow("Only ui://");
    expect(harness.readResource).not.toHaveBeenCalled();
  });

  it("turns ui/message text into a continuation on the same run", async () => {
    harness.continueRun.mockResolvedValue({ runId: "run-1" });

    await expect(
      mcpAppsService.sendMessage({
        runId: "run-1",
        content: [{ type: "text", text: "Book this flight" }],
        modelContext: { structuredContent: { flightId: "flight-1" } },
      }),
    ).resolves.toEqual({ runId: "run-1" });
    expect(harness.continueRun).toHaveBeenCalledWith({
      runId: "run-1",
      accountId: "account-1",
      message: "Book this flight",
      additionalContext: [{
        kind: "note",
        content: 'Interactive MCP App context:\n{"flightId":"flight-1"}',
      }],
    });
  });

  it("hosts a standalone app without a run and rejects resources outside its session", async () => {
    const app = {
      id: "tldraw-entry", name: "tldraw", server: "codex_apps", tool: "tldraw.tldraw_home",
      resourceUri: "ui://tldraw/app.html", entrypoints: ["global"], preferredModelDisplayMode: "fullscreen",
    };
    harness.openSession.mockResolvedValue({
      id: "app-session", app, output: { content: [] },
      resource: { contents: [{ uri: app.resourceUri, mimeType: "text/html;profile=mcp-app", text: "<main>Canvas</main>" }] },
    });
    harness.callSessionTool.mockResolvedValue({ content: [] });
    await expect(mcpAppsService.openExtension({ providerId: "codex", entrypointId: app.id }))
      .resolves.toMatchObject({ sessionId: "app-session", app });
    await mcpAppsService.readResource({ sessionId: "app-session", server: app.server, resourceUri: app.resourceUri });
    await expect(mcpAppsService.readResource({
      sessionId: "app-session", server: app.server, resourceUri: "ui://other/app.html",
    })).rejects.toThrow("does not belong");
    await mcpAppsService.callTool({ sessionId: "app-session", server: app.server, tool: "_dotcom_boards" });
    expect(harness.callSessionTool).toHaveBeenCalledWith("app-session", "_dotcom_boards", undefined, undefined);
    expect(harness.findRunById).not.toHaveBeenCalled();
    await mcpAppsService.closeExtension({ sessionId: "app-session" });
    expect(harness.closeSession).toHaveBeenCalledWith("app-session");
    expect(harness.removeDocument).toHaveBeenCalled();
    await expect(mcpAppsService.callTool({ sessionId: "app-session", server: app.server, tool: "_dotcom_boards" }))
      .rejects.toThrow("expired");
  });

  it("closes the provider session if its resource cannot be hosted", async () => {
    harness.openSession.mockResolvedValue({
      id: "bad-session", app: { resourceUri: "ui://bad/app.html" },
      resource: { contents: [{ uri: "ui://bad/app.html", text: "not HTML", mimeType: "text/plain" }] },
    });
    await expect(mcpAppsService.openExtension({ providerId: "codex", entrypointId: "bad-app" }))
      .rejects.toThrow("Unsupported MCP App resource type");
    expect(harness.closeSession).toHaveBeenCalledWith("bad-session");
  });

  it("closes a session through its original adapter after the provider is disabled", async () => {
    const app = { id: "bound-app", name: "Canvas", server: "apps", tool: "canvas", resourceUri: "ui://canvas", entrypoints: ["global"] };
    harness.openSession.mockResolvedValue({ id: "bound-session", app, output: {},
      resource: { contents: [{ uri: app.resourceUri, text: "<main>Canvas</main>", mimeType: "text/html" }] } });
    await mcpAppsService.openExtension({ providerId: "codex", entrypointId: app.id });
    harness.getProviderById.mockResolvedValue({ id: "codex", isEnabled: false });
    await expect(mcpAppsService.callTool({ sessionId: "bound-session", server: app.server, tool: "canvas" })).rejects.toThrow("not enabled");
    expect(harness.callSessionTool).not.toHaveBeenCalled();
    await expect(mcpAppsService.closeExtension({ sessionId: "bound-session" })).resolves.toBeUndefined();
    expect(harness.closeSession).toHaveBeenCalledExactlyOnceWith("bound-session");
  });

  it("retains a failed native close for retry while refusing resource and tool admission", async () => {
    const app = { id: "retry-app", name: "Canvas", server: "apps", tool: "canvas", resourceUri: "ui://canvas", entrypoints: ["global"] };
    harness.openSession.mockResolvedValue({ id: "retry-session", app, output: {},
      resource: { contents: [{ uri: app.resourceUri, text: "<main>Canvas</main>", mimeType: "text/html" }] } });
    await mcpAppsService.openExtension({ providerId: "codex", entrypointId: app.id });
    harness.closeSession.mockRejectedValueOnce(new Error("Native close interrupted"));
    await expect(mcpAppsService.closeExtension({ sessionId: "retry-session" })).rejects.toThrow("interrupted");
    await expect(mcpAppsService.readResource({ sessionId: "retry-session", server: app.server, resourceUri: app.resourceUri })).rejects.toThrow("expired");
    await expect(mcpAppsService.callTool({ sessionId: "retry-session", server: app.server, tool: "canvas" })).rejects.toThrow("expired");
    await mcpAppsService.closeExtension({ sessionId: "retry-session" });
    expect(harness.closeSession).toHaveBeenCalledTimes(2);
    expect(harness.removeDocument).toHaveBeenCalledTimes(1);
  });

  it("drains a pending open and releases its late session when all extensions close", async () => {
    let finish!: (session: unknown) => void;
    harness.openSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const opening = mcpAppsService.openExtension({ providerId: "codex", entrypointId: "late-app" });
    const result = opening.then(() => "opened", () => "retired");
    await vi.waitFor(() => expect(harness.openSession).toHaveBeenCalledOnce());
    let drained = false;
    const closing = mcpAppsService.closeAllExtensions().then(() => { drained = true; });
    const app = { id: "late-app", name: "Canvas", server: "apps", tool: "canvas", resourceUri: "ui://canvas", entrypoints: ["global"] };
    try {
      await new Promise<void>((resolve) => setImmediate(resolve)); expect(drained).toBe(false);
      await expect(mcpAppsService.openExtension({ providerId: "codex", entrypointId: "do-not-open" })).rejects.toThrow("closing");
      expect(harness.openSession).toHaveBeenCalledOnce();
    } finally {
      finish({ id: "late-session", app, output: {}, resource: { contents: [{ uri: app.resourceUri, text: "<main>Canvas</main>", mimeType: "text/html" }] } });
      await result; await closing;
      await mcpAppsService.closeAllExtensions();
    }
    expect(await result).toBe("retired");
    expect(harness.registerDocument).not.toHaveBeenCalled();
    expect(harness.closeSession).toHaveBeenCalledExactlyOnceWith("late-session");
  });

  it("keeps tool calls on the acquiring adapter when provider configuration changes", async () => {
    const app = { id: "tools-app", name: "Canvas", server: "apps", tool: "canvas", resourceUri: "ui://canvas", entrypoints: ["global"] };
    harness.openSession.mockResolvedValue({ id: "tools-session", app, output: {},
      resource: { contents: [{ uri: app.resourceUri, text: "<main>Canvas</main>", mimeType: "text/html" }] } });
    await mcpAppsService.openExtension({ providerId: "codex", entrypointId: app.id });
    const replacementTool = vi.fn();
    harness.createAdapter.mockReturnValue({ callMcpAppSessionTool: replacementTool });
    try {
      await mcpAppsService.callTool({ sessionId: "tools-session", server: app.server, tool: "canvas" });
      expect(harness.callSessionTool).toHaveBeenCalledExactlyOnceWith("tools-session", "canvas", undefined, undefined);
      expect(replacementTool).not.toHaveBeenCalled();
    } finally { await mcpAppsService.closeExtension({ sessionId: "tools-session" }); }
  });

  it("refuses a tool call whose session closes during the provider availability check", async () => {
    const app = { id: "checked-app", name: "Canvas", server: "apps", tool: "canvas", resourceUri: "ui://canvas", entrypoints: ["global"] };
    harness.openSession.mockResolvedValue({ id: "checked-session", app, output: {},
      resource: { contents: [{ uri: app.resourceUri, text: "<main>Canvas</main>", mimeType: "text/html" }] } });
    await mcpAppsService.openExtension({ providerId: "codex", entrypointId: app.id });
    let finish!: (provider: unknown) => void;
    harness.getProviderById.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const calling = mcpAppsService.callTool({ sessionId: "checked-session", server: app.server, tool: "canvas" });
    const refused = expect(calling).rejects.toThrow("expired");
    await mcpAppsService.closeExtension({ sessionId: "checked-session" });
    finish({ id: "codex", isEnabled: true });
    await refused;
    expect(harness.callSessionTool).not.toHaveBeenCalled();
  });

  it("retries failed cleanup of an acquired session whose resource could not be hosted", async () => {
    harness.openSession.mockResolvedValue({ id: "unhosted-session", app: { resourceUri: "ui://bad" },
      resource: { contents: [{ uri: "ui://bad", text: "Not HTML", mimeType: "text/plain" }] } });
    harness.closeSession.mockRejectedValueOnce(new Error("Native close interrupted"));
    await expect(mcpAppsService.openExtension({ providerId: "codex", entrypointId: "bad" })).rejects.toThrow("Unsupported MCP App resource type");
    await mcpAppsService.closeAllExtensions();
    expect(harness.closeSession).toHaveBeenCalledTimes(2);
    expect(harness.closeSession).toHaveBeenLastCalledWith("unhosted-session");
  });

  it("shares native cleanup between concurrent close and close-all requests", async () => {
    const app = { id: "closing-app", name: "Canvas", server: "apps", tool: "canvas", resourceUri: "ui://canvas", entrypoints: ["global"] };
    harness.openSession.mockResolvedValue({ id: "closing-session", app, output: {},
      resource: { contents: [{ uri: app.resourceUri, text: "<main>Canvas</main>", mimeType: "text/html" }] } });
    await mcpAppsService.openExtension({ providerId: "codex", entrypointId: app.id });
    let finish!: () => void;
    harness.closeSession.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = mcpAppsService.closeExtension({ sessionId: "closing-session" });
    const second = mcpAppsService.closeExtension({ sessionId: "closing-session" });
    const all = mcpAppsService.closeAllExtensions();
    try {
      await vi.waitFor(() => expect(harness.closeSession).toHaveBeenCalledOnce());
      await expect(mcpAppsService.readResource({ sessionId: "closing-session", server: app.server, resourceUri: app.resourceUri })).rejects.toThrow("expired");
    } finally { finish(); await Promise.all([first, second, all]); }
    await mcpAppsService.closeExtension({ sessionId: "closing-session" });
    expect(harness.closeSession).toHaveBeenCalledOnce();
    expect(harness.removeDocument).toHaveBeenCalledOnce();
  });
});
