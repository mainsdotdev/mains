import { describe, it, expect } from "vitest";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import type { MainsToolContext } from "./mains-tools.core";
import {
  MAINS_TOOLS,
  toClaudeTools,
  toCopilotTools,
  toMcpToolDefs,
  toCodexDynamicTools,
  toJsonSchema,
  dispatchMainsTool,
} from "./mains-tools.registry";
import {
  SaveFindingSchema,
  SaveReviewSchema,
} from "./mains-tools.schemas";

const CTX: MainsToolContext = {
  workspaceId: "ws_1",
  rootPath: "/tmp/repo",
  runId: "run_1",
};

/** Tools the registry marks available to a given provider. */
function expectedFor(provider: string): string[] {
  return MAINS_TOOLS.filter((t) => t.providers.includes(provider as any))
    .map((t) => t.name)
    .sort();
}

describe("mains tool registry — per-provider consistency", () => {
  it("Claude renderer emits exactly the tools available to Claude", () => {
    const names = toClaudeTools(CTX).map((t) => t.name).sort();
    expect(names).toEqual(expectedFor(PROVIDER_IDS.claude));
  });

  it("Copilot renderer emits exactly Copilot's tools, mcp__mains__-prefixed", () => {
    const specs = toCopilotTools(CTX);
    const bare = specs.map((t) => t.name.replace(/^mcp__mains__/, "")).sort();
    expect(specs.every((t) => t.name.startsWith("mcp__mains__"))).toBe(true);
    expect(bare).toEqual(expectedFor(PROVIDER_IDS.copilot));
  });

  it("Cursor MCP defs emit exactly Cursor's tools", () => {
    const names = toMcpToolDefs().map((t) => t.name).sort();
    expect(names).toEqual(expectedFor(PROVIDER_IDS.cursor));
  });

  it("Codex dynamic tools emit exactly Codex's tools", () => {
    const names = toCodexDynamicTools().map((t) => t.name).sort();
    expect(names).toEqual(expectedFor(PROVIDER_IDS.codex));
  });
});

describe("mains tool registry — availability matrix", () => {
  it("CheckPackage is exposed only to Codex and Cursor (Bash-hook guard elsewhere)", () => {
    const checkPackage = MAINS_TOOLS.find((t) => t.name === "CheckPackage")!;
    expect([...checkPackage.providers].sort()).toEqual(
      [PROVIDER_IDS.codex, PROVIDER_IDS.cursor].sort(),
    );
  });

  it("review-flow tools are not exposed to Codex", () => {
    for (const name of ["SaveReview", "SaveFinding", "SaveFindings"]) {
      const tool = MAINS_TOOLS.find((t) => t.name === name)!;
      expect(tool.providers).not.toContain(PROVIDER_IDS.codex);
    }
  });
});

describe("mains tool registry — JSON Schema rendering", () => {
  it("strips $schema and additionalProperties from the output", () => {
    const schema = toJsonSchema(SaveReviewSchema);
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBeUndefined();
    const findings = JSON.stringify(toJsonSchema(SaveFindingSchema));
    expect(findings).not.toContain("$schema");
    expect(findings).not.toContain("additionalProperties");
  });

  it("preserves SaveFinding's required fields", () => {
    const schema = toJsonSchema(SaveFindingSchema) as any;
    expect([...schema.required].sort()).toEqual(
      ["file", "message", "reason", "reviewId", "severity"].sort(),
    );
  });
});

describe("mains tool registry — dispatch", () => {
  it("returns an error result for an unknown tool", async () => {
    const result = await dispatchMainsTool("NoSuchTool", {}, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });

  it("every registry tool resolves to a handler (no missing dispatch)", () => {
    for (const tool of MAINS_TOOLS) {
      expect(typeof tool.handler).toBe("function");
    }
  });
});

describe("mains tool registry — mode dimension", () => {
  it("defaults to developer: mode-less renderer calls match today's sets", () => {
    expect(toClaudeTools(CTX).map((t) => t.name).sort()).toEqual(
      toClaudeTools(CTX, "developer").map((t) => t.name).sort(),
    );
    expect(toCodexDynamicTools().map((t) => t.name).sort()).toEqual(
      toCodexDynamicTools("developer").map((t) => t.name).sort(),
    );
  });

  it("work exposes no mains tools on any provider", () => {
    expect(toClaudeTools(CTX, "work")).toHaveLength(0);
    expect(toCopilotTools(CTX, "work")).toHaveLength(0);
    expect(toMcpToolDefs("work")).toHaveLength(0);
    expect(toCodexDynamicTools("work")).toHaveLength(0);
  });

  it("chat exposes no mains tools on any provider", () => {
    expect(toClaudeTools(CTX, "chat")).toHaveLength(0);
    expect(toCopilotTools(CTX, "chat")).toHaveLength(0);
    expect(toMcpToolDefs("chat")).toHaveLength(0);
    expect(toCodexDynamicTools("chat")).toHaveLength(0);
  });

  it("every tool's modes list (when present) only names known modes", () => {
    for (const tool of MAINS_TOOLS) {
      for (const mode of tool.modes ?? []) {
        expect(["developer", "work", "chat"]).toContain(mode);
      }
    }
  });
});
