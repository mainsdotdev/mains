import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  findRunById: vi.fn(),
  getProviderById: vi.fn(),
  readResource: vi.fn(),
  callTool: vi.fn(),
  continueRun: vi.fn(),
  registerDocument: vi.fn(),
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
  }),
}));
vi.mock("./mcpApps.registry", () => ({
  mcpAppsRegistry: { register: harness.registerDocument },
}));

import { mcpAppsService } from "./mcpApps.service";

describe("mcpAppsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    });

    expect(harness.readResource).toHaveBeenCalledWith({
      runId: "run-1",
      server: "codex_apps",
      uri: "ui://widgets/flights.html",
      originCallId: "call-1",
      connectorId: "skyscanner",
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
      },
    );
    expect(result.url).toBe("mains-mcp-app://resource/token/index.html");
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
});
