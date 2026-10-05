import { describe, expect, it } from "vitest";
import { mcpAppContextItems, mcpAppContextState, mcpAppMessageOptions, mcpAppMessageText, normalizeMcpAppContext } from "./mcp-app-context";
import { buildRunContextPayload } from "./run-context-payload";
import reducer, { addContextItem, removeContextItem, replaceMcpAppContext, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";

describe("MCP App composer context", () => {
  const context = normalizeMcpAppContext({ content: [
    { type: "text", text: "Selected card", _meta: { "openai/title": "Card", token: "private-token" } },
    { type: "text", text: "Canvas canvas-1", annotations: { audience: ["assistant"] } },
  ], structuredContent: { canvasId: "canvas-1" }, _meta: { token: "private-token" } });
  const items = mcpAppContextItems("session-1", "MagicPath", { ...context, updateId: "update-1" });

  it("replaces one app's selection without touching other app or user attachments", () => {
    let state = reducer(undefined, setComposerContextKey("app-owner"));
    state = reducer(state, addContextItem({ kind: "skill", name: "review" }));
    const other = mcpAppContextItems("session-2", "Canva", { content: [{ type: "text", text: "A slide" }], updateId: "other" });
    state = reducer(state, replaceMcpAppContext({ key: "app-owner", sessionId: "session-2", items: other }));
    state = reducer(state, replaceMcpAppContext({ key: "app-owner", sessionId: "session-1", items }));
    const replacement = mcpAppContextItems("session-1", "MagicPath", { content: [{ type: "text", text: "New card" }], updateId: "update-2" });
    state = reducer(state, replaceMcpAppContext({ key: "app-owner", sessionId: "session-1", items: replacement }));
    expect(state.contextItems).toEqual([{ kind: "skill", name: "review" }, ...other, ...replacement]);
    state = reducer(state, replaceMcpAppContext({ key: "app-owner", sessionId: "session-1", items: [] }));
    expect(state.contextItems).toEqual([{ kind: "skill", name: "review" }, ...other]);
  });

  it("removes a single block and renews the host's context identity", () => {
    let state = reducer(undefined, setComposerContextKey("app-owner"));
    state = reducer(state, replaceMcpAppContext({ key: "app-owner", sessionId: "session-1", items }));
    state = reducer(state, removeContextItem({ kind: "mcp-app", key: items[0].id }));
    const remaining = state.contextItems.filter((item) => item.kind === "mcp-app");
    const host = mcpAppContextState(remaining, "session-1");
    expect(host?.content).toEqual([context.content![1]]);
    expect(host?.structuredContent).toEqual({ canvasId: "canvas-1" });
    expect(host?.updateId).not.toBe("update-1");
  });

  it("sends text and structured context to both run operations without UI/auth metadata", () => {
    expect(items.map((item) => item.hidden)).toEqual([false, true, true]);
    const payload = buildRunContextPayload(items);
    expect(payload.initialContext.map((item) => item.content)).toEqual(["Selected card", "Canvas canvas-1", '{"canvasId":"canvas-1"}']);
    expect(JSON.stringify(payload)).not.toContain("private-token");
    expect(JSON.stringify(payload)).not.toContain("openai/title");
  });

  it("turns image blocks into actual model attachments and retains resource references", () => {
    const blocks = normalizeMcpAppContext({ content: [
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
      { type: "resource_link", uri: "design://card", name: "Card", _meta: { token: "private" } },
      { type: "resource", resource: { uri: "design://notes", text: "Design notes", _meta: { token: "private" } } },
    ] });
    const payload = buildRunContextPayload(mcpAppContextItems("session-1", "Canva", { ...blocks, updateId: "update" }));
    expect(payload.attachments).toEqual([{ name: "Canva-selection-0.png", type: "image", data: "aW1hZ2U=", mimeType: "image/png" }]);
    expect(payload.initialContext).toHaveLength(2);
    expect(JSON.stringify(payload)).toContain("design://card");
    expect(JSON.stringify(payload)).not.toContain("private");
  });

  it("rejects unsupported, oversized, and malformed app input", () => {
    expect(() => normalizeMcpAppContext({ content: [{ type: "audio", data: "abc" }] })).toThrow("Unsupported");
    expect(() => normalizeMcpAppContext({ content: [{ type: "text", text: "x".repeat(128_001) }] })).toThrow("Invalid");
    expect(() => normalizeMcpAppContext({ structuredContent: [] })).toThrow("object");
    expect(() => normalizeMcpAppContext({ content: [{ type: "image", data: "not base64", mimeType: "image/png" }] })).toThrow("image");
    expect(() => mcpAppMessageText([{ type: "text", text: "  " }])).toThrow("message");
    expect(mcpAppMessageText([{ type: "text", text: " First " }, { type: "text", text: "Second" }])).toBe("First \nSecond");
  });

  it("validates message routing separately from content and rejects unsupported send behavior", () => {
    expect(mcpAppMessageOptions(undefined)).toEqual({});
    expect(mcpAppMessageOptions({ "openai/message": { target: "new", send: true }, token: "private" })).toEqual({ target: "new" });
    expect(() => mcpAppMessageOptions({ "openai/message": { target: "other-chat" } })).toThrow("options");
    expect(() => mcpAppMessageOptions({ "openai/message": { send: false } })).toThrow("options");
  });
});
