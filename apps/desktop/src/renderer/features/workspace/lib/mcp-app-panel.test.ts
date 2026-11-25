import { describe, expect, it } from "vitest";
import { mcpAppConversationPath, mcpAppToolName, sameMcpApp, sameMcpAppScope } from "./mcp-app-panel";
import { composerOwnerKey, mcpAppConversationKey } from "./ui-context";
import { previewOwnerKey } from "./preview-tabs";
describe("MCP App panel routing", () => {
  it("keeps assistant previews and app conversation identities separate from Code and other assistants", () => {
    const scope = { backendId: null, spaceId: "space", providerId: "codex", mode: "developer", workspaceId: "repo", assistantId: "gezici" };
    expect(mcpAppConversationPath(scope, "run")).toBe("/assistants?assistant=gezici&run=run");
    expect(mcpAppConversationPath(scope)).toBe("/assistants?assistant=gezici&run=new");
    const owner = composerOwnerKey(scope, "run");
    expect(previewOwnerKey(scope, owner)).toBe(owner);
    expect(composerOwnerKey(scope, null)).toBe("local:assistant:gezici:draft");
    const other = { ...scope, assistantId: "testflight" };
    expect(sameMcpAppScope(scope, other)).toBe(false);
    expect(mcpAppConversationKey(scope, "app")).not.toBe(mcpAppConversationKey(other, "app"));
    expect(mcpAppConversationKey(scope, "app")).not.toBe(mcpAppConversationKey({ ...scope, assistantId: undefined }, "app"));
  });

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
