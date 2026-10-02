import { describe, expect, it } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { mcpAppPinKey, normalizeMcpAppPins } from "./mcp-app-extensions";

const app: McpAppEntrypoint = {
  id: JSON.stringify(["codex_apps", "magicpath.open", "magicpath", "old-link"]),
  name: "MagicPath", server: "codex_apps", tool: "magicpath.open", pluginId: "magicpath@catalog",
  connectorId: "magicpath", linkId: "old-link", resourceUri: "ui://canvas", entrypoints: ["global"], preferredModelDisplayMode: "fullscreen",
};

describe("logical MCP app pin identity", () => {
  it("survives reconnects, server changes, names, icons and resource revisions", () => {
    expect(mcpAppPinKey({ ...app, id: "new-id", linkId: "new-link", connectorId: "new-connector",
      server: "new-server", name: "Renamed", resourceUri: "ui://canvas-v2", icons: [{ src: "new.svg" }] }))
      .toBe(mcpAppPinKey(app));
    expect(mcpAppPinKey({ ...app, tool: "magicpath.other" })).not.toBe(mcpAppPinKey(app));
    expect(mcpAppPinKey({ ...app, pluginId: "another-plugin" })).not.toBe(mcpAppPinKey(app));
  });

  it("uses connector ownership, then server ownership, when plugin metadata is absent", () => {
    const connectorApp = { ...app, pluginId: undefined };
    expect(mcpAppPinKey({ ...connectorApp, server: "new-server", linkId: "new-link" })).toBe(mcpAppPinKey(connectorApp));
    expect(mcpAppPinKey({ ...connectorApp, connectorId: "other" })).not.toBe(mcpAppPinKey(connectorApp));
    const serverApp = { ...connectorApp, connectorId: undefined };
    expect(mcpAppPinKey({ ...serverApp, linkId: "new-link" })).toBe(mcpAppPinKey(serverApp));
    expect(mcpAppPinKey({ ...serverApp, server: "other" })).not.toBe(mcpAppPinKey(serverApp));
  });

  it("migrates legacy links after reconnecting and merges account pins in original order", () => {
    const newAccount = { ...app, id: "new-id", linkId: "new-link", server: "new-server" };
    expect(normalizeMcpAppPins([app.id, newAccount.id, mcpAppPinKey(app)], [newAccount]))
      .toEqual([mcpAppPinKey(app)]);
    expect(normalizeMcpAppPins([app.id], [])).toEqual([app.id]);
    expect(normalizeMcpAppPins([mcpAppPinKey(app)], [])).toEqual([mcpAppPinKey(app)]);
  });

  it("keeps unknown or ambiguous legacy ids without guessing another plugin", () => {
    expect(normalizeMcpAppPins([app.id], [{ ...app, id: "different-id", tool: "different-tool" }])).toEqual([app.id]);
    const accounts = [{ ...app, id: "one" }, { ...app, id: "two", pluginId: "other-plugin" }];
    expect(normalizeMcpAppPins([app.id, "not-json"], accounts)).toEqual([app.id, "not-json"]);
  });
});
