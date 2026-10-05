import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("@mains/backend/modules/runs", () => ({
  runsService: {
    getRunById: harness.findRunById,
    continueRun: harness.continueRun,
  },
}));
vi.mock("@mains/backend/modules/providers", () => ({
  providersService: { getById: harness.getProviderById },
  createWorkAdapter: () => ({
    readMcpAppResource: harness.readResource,
    callMcpAppTool: harness.callTool,
    openMcpAppSession: harness.openSession,
    closeMcpAppSession: harness.closeSession,
    callMcpAppSessionTool: harness.callSessionTool,
  }),
}));
vi.mock("./mcpApps.registry", () => ({
  mcpAppsRegistry: { register: harness.registerDocument, remove: harness.removeDocument },
}));

import { mcpAppsService } from "./mcpApps.service";

describe("mcpAppsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
