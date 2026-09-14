import { describe, it, expect } from "vitest";
import { toolOutputText, previewParams, parseToolContent } from "./parse-tool-content";

// Adapters persist `tool_calls.output` in three different encodings depending on
// the provider, and the tool displays (SendMessage, Monitor, …) render whatever
// comes back. Getting the shape wrong shows an empty panel rather than an error,
// so each encoding is pinned here.
describe("toolOutputText", () => {
  it("returns empty string for absent output", () => {
    expect(toolOutputText(undefined)).toBe("");
    expect(toolOutputText(null)).toBe("");
    expect(toolOutputText("")).toBe("");
  });

  it("passes a plain string through, trimmed", () => {
    // A failed Monitor persists its error as a bare JSON-encoded string.
    expect(toolOutputText('"Tool permission request failed: AbortError"')).toBe(
      "Tool permission request failed: AbortError",
    );
    expect(toolOutputText("  npm ci process ended  ")).toBe("npm ci process ended");
  });

  it("flattens an Anthropic content-block array", () => {
    // Real SendMessage output: a bare block array whose text is itself JSON.
    const output = JSON.stringify([
      { type: "text", text: '{"success":true,"resumedAgentId":"a73ef5c3bd7618eef"}' },
    ]);
    expect(toolOutputText(output)).toBe(
      '{"success":true,"resumedAgentId":"a73ef5c3bd7618eef"}',
    );
  });

  it("unwraps an MCP `content` envelope and joins multiple blocks", () => {
    const output = {
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    };
    expect(toolOutputText(output)).toBe("first\nsecond");
  });

  it("falls back to pretty JSON when there are no text blocks", () => {
    expect(toolOutputText({ exitCode: 0 })).toBe('{\n  "exitCode": 0\n}');
  });
});

// A tool with no registry entry (new SDK tool, plugin tool, unregistered
// provider) falls through to GenericToolDisplay, whose header line is only as
// good as this preview. The old behaviour showed "(6 params)" for all of them.
describe("previewParams", () => {
  it("prefers a well-known descriptive key over declaration order", () => {
    expect(previewParams({ id: "x1", description: "Deploy the API" })).toBe(
      "Deploy the API",
    );
  });

  it("labels the first scalar when no known key is present", () => {
    expect(previewParams({ branch: "main", force: true })).toBe("branch: main");
  });

  it("skips noise keys and nested objects", () => {
    expect(previewParams({ type: "call", config: { a: 1 }, region: "eu" })).toBe(
      "region: eu",
    );
  });

  it("collapses whitespace and truncates long values", () => {
    const preview = previewParams({ prompt: `a${"b".repeat(200)}\n\nc` });
    expect(preview).toHaveLength(81); // 80 chars + ellipsis
    expect(preview.endsWith("…")).toBe(true);
    expect(preview).not.toContain("\n");
  });

  it("returns empty when nothing is previewable", () => {
    expect(previewParams({ config: { a: 1 } })).toBe("");
    expect(previewParams(null)).toBe("");
  });
});

describe("parseToolContent — unregistered tool summary", () => {
  it("derives a readable summary instead of the param count", () => {
    const { toolName, summary } = parseToolContent(
      'SomeNewTool: {"to":"researcher","message":"start on task #1"}',
    );
    expect(toolName).toBe("SomeNewTool");
    expect(summary).toBe("start on task #1");
  });

  it("still falls back to the param count when nothing is previewable", () => {
    expect(parseToolContent('X: {"config":{"a":1}}').summary).toBe("(1 params)");
  });
});
