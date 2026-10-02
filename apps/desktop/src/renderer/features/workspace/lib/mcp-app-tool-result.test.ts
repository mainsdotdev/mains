import { describe, expect, it } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import type { RunEvent } from "../types";
import { latestMcpAppToolResult } from "./mcp-app-tool-result";

const app: McpAppEntrypoint = { id: "app", name: "Canvas", server: "codex_apps", tool: "canvas.home", resourceUri: "ui://canvas",
  connectorId: "connector", linkId: "account", entrypoints: ["global"], preferredModelDisplayMode: "fullscreen" };
const event = (overrides: Record<string, unknown> = {}, timestamp = 2_000): RunEvent => ({ id: "tool-1", type: "tool_call", content: "canvas.home", timestamp: new Date(timestamp),
  metadata: { status: "completed", mcpApp: { ...app }, input: '{"projectId":"new-project"}',
    output: JSON.stringify({ content: [], _meta: { canvas: "UI-only bootstrap" } }), ...overrides } });

describe("model result routing to a permanent app", () => {
  it("updates the existing app with new tool input and its UI-only result", () => {
    expect(latestMcpAppToolResult([event()], app, 1_000)).toEqual({ input: { projectId: "new-project" }, output: { content: [], _meta: { canvas: "UI-only bootstrap" } } });
  });
  it("accepts the persisted done status without rewriting transcript events", () => {
    expect(latestMcpAppToolResult([event({ status: "done" })], app, 1_000)?.input).toEqual({ projectId: "new-project" });
  });
  it("does not replay historical bootstrap results from an old conversation", () => {
    expect(latestMcpAppToolResult([event({}, 500)], app, 1_000)).toBeUndefined();
  });
  it("rejects another connector, account, server or UI document", () => {
    for (const override of [{ connectorId: "other" }, { linkId: "other" }, { server: "other" }, { resourceUri: "ui://other" }]) {
      expect(latestMcpAppToolResult([event({ mcpApp: { ...app, ...override } })], app, 1_000)).toBeUndefined();
    }
    expect(latestMcpAppToolResult([event({ mcpApp: { ...app, linkId: undefined } })], app, 1_000)).toBeUndefined();
  });
  it("ignores running and failed calls instead of replacing the canvas", () => {
    expect(latestMcpAppToolResult([event({ status: "running" })], app, 1_000)).toBeUndefined();
    expect(latestMcpAppToolResult([event({ output: { content: [], isError: true } })], app, 1_000)).toBeUndefined();
  });
});
