import { describe, expect, it } from "vitest";
import { mcpAppConversationPath, mcpAppToolName, sameMcpApp } from "./mcp-app-panel";
describe("MCP App panel routing", () => {
  it("qualifies UI tool names using the actual connector namespace", () => {
    expect(mcpAppToolName("codex_apps", "magicpath.open_magicpath_canvas", "create_canvas_app_session")).toBe("magicpath.create_canvas_app_session");
    expect(mcpAppToolName("codex_apps", "magicpath.open_magicpath_canvas", "magicpath.create_canvas_app_session")).toBe("magicpath.create_canvas_app_session");
    expect(mcpAppToolName("local", "canvas.home", "read_selection")).toBe("read_selection");
  });
  it("keeps UI ownership distinct for different servers, resources, connectors and accounts", () => {
    const app = { server: "codex_apps", resourceUri: "ui://canvas", connectorId: "connector", linkId: "account" };
    expect(sameMcpApp(app, { ...app })).toBe(true);
    for (const change of [{ server: "other" }, { resourceUri: "ui://other" }, { connectorId: "other" }, { linkId: "other" }])
      expect(sameMcpApp(app, { ...app, ...change })).toBe(false);
  });
  it("returns to the normal conversation route in each mode", () => {
    const scope = { backendId: null, spaceId: "space", providerId: "codex", mode: "developer", workspaceId: "ws" };
    expect(mcpAppConversationPath(scope, "run")).toBe("/code/ws");
    expect(mcpAppConversationPath({ ...scope, mode: "work", workspaceId: undefined }, "run")).toBe("/code/runs/run");
    expect(mcpAppConversationPath({ ...scope, mode: "chat", workspaceId: undefined })).toBe("/code");
  });
});
