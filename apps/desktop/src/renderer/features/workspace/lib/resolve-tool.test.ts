import { describe, it, expect } from "vitest";
import { resolveTool } from "./resolve-tool";

// Connected codex apps (Gmail, Linear, Google Calendar, …) are bridged through
// the `codex_apps` MCP server. The app slug `resolveTool` extracts is what the
// plugin-logo lookup keys on, so mis-parsing it swaps the app's real logo for
// the generic MCP glyph. Newer codex builds switched the app/verb delimiter
// from `_` to `.`, which the first-underscore heuristic mis-split
// (`gmail.get_profile` → `gmail.get`) — this guards both delimiters.
describe("resolveTool — codex_apps bridge sub-provider slug", () => {
  it("parses dot-delimited app names (current codex format)", () => {
    expect(resolveTool("mcp__codex_apps__gmail.get_profile").vendorId).toBe(
      "gmail",
    );
    expect(resolveTool("mcp__codex_apps__linear.list_teams").vendorId).toBe(
      "linear",
    );
    // App slug may itself contain underscores — the dot is the real boundary.
    expect(
      resolveTool("mcp__codex_apps__google_calendar.get_profile").vendorId,
    ).toBe("google_calendar");
  });

  it("still parses legacy underscore-delimited app names", () => {
    expect(resolveTool("mcp__codex_apps__gmail_get_profile").vendorId).toBe(
      "gmail",
    );
    expect(resolveTool("mcp__codex_apps__linear_list_issues").vendorId).toBe(
      "linear",
    );
  });
});

// Both tools resolve as builtins so `ToolCallItem` can dispatch them to their
// dedicated displays. Without a registry entry they fall through to the generic
// "unknown tool" row, and `vendorId` would stay undefined so even the MCP
// fallback renderer wouldn't pick them up.
describe("resolveTool — SendMessage / Monitor builtins", () => {
  it("resolves SendMessage on both alias spellings", () => {
    for (const name of ["SendMessage", "sendmessage", "send_message"]) {
      const resolved = resolveTool(name);
      expect(resolved.displayName).toBe("SendMessage");
      expect(resolved.groupKey).toBe("sendmessage");
      expect(resolved.isBuiltin).toBe(true);
      expect(resolved.vendorId).toBeUndefined();
    }
  });

  it("resolves Monitor, including the `toolName: {json}` content form", () => {
    const resolved = resolveTool('Monitor: {"description":"errors in deploy.log"}');
    expect(resolved.displayName).toBe("Monitor");
    expect(resolved.groupKey).toBe("monitor");
    expect(resolved.isBuiltin).toBe(true);
  });

  // The loose contains-fallback in `findBuiltin` must not let the new short-ish
  // aliases swallow unrelated MCP tools — MCP names skip builtins entirely.
  it("does not claim MCP tools whose names contain the aliases", () => {
    expect(resolveTool("mcp__slack__send_message").isBuiltin).toBe(false);
    expect(resolveTool("mcp__sentry__monitor_list").isBuiltin).toBe(false);
  });
});

// Unregistered tools render through GenericToolDisplay, which shows this label
// as its header verb — so a raw wire name must not leak through mangled.
describe("resolveTool — unregistered tool labels", () => {
  it("keeps PascalCase names verbatim", () => {
    expect(resolveTool("SomeNewTool").displayName).toBe("SomeNewTool");
  });

  it("splits snake_case and kebab-case into words", () => {
    expect(resolveTool("some_new_tool").displayName).toBe("Some new tool");
    expect(resolveTool("some-new-tool").displayName).toBe("Some new tool");
  });

  it("capitalizes bare lowercase names", () => {
    expect(resolveTool("deploy").displayName).toBe("Deploy");
  });
});
