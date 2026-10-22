import { describe, it, expect, vi, afterEach } from "vitest";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { workspaceService } from "../../workspace";
import { guardsService } from "../../guards/guards.service";
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
  SaveFindingsSchema,
  SaveReviewSchema,
} from "./mains-tools.schemas";

const CTX: MainsToolContext = {
  workspaceId: "ws_1",
  rootPath: "/tmp/repo",
  runId: "run_1",
};

/** Tools the registry marks available to a given provider. */
function expectedFor(provider: string): string[] {
  return MAINS_TOOLS.filter((t) => !t.scope && (!t.modes || t.modes.includes("developer")) && t.providers.includes(provider as any))
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
  it("exposes coordination tools only to a Codex voice bridge, in every mode", () => {
    const names = ["StartVoiceTask", "ListVoiceTasks", "ReadVoiceTask", "WaitVoiceTask", "SendVoiceTaskMessage", "StopVoiceTask", "EndVoiceChat"];
    for (const mode of ["developer", "work", "chat"] as const) {
      expect(toMcpToolDefs(mode, PROVIDER_IDS.codex, "voice").map((tool) => tool.name)).toEqual(names);
      expect(toCodexDynamicTools(mode).some((tool) => "name" in tool && names.includes(tool.name))).toBe(false);
      expect(toMcpToolDefs(mode).some((tool) => names.includes(tool.name))).toBe(false);
    }
  });

  it("rejects coordination without an active capability and validates tool input", async () => {
    await expect(dispatchMainsTool("StartVoiceTask", { taskKey: "task", title: "Work", prompt: "Do work" }, CTX)).rejects.toThrow("outside the active voice");
    const start = async () => { throw new Error("should not dispatch invalid input"); };
    await expect(dispatchMainsTool("StartVoiceTask", { taskKey: "../bad", title: "", prompt: "" }, { ...CTX, voiceTools: { start } as never })).rejects.toThrow();
  });
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

describe("mains tool registry — argument validation", () => {
  const FINDING = { severity: "warning", file: "src/a.ts", message: "Leaky", reason: "Never closed" };
  afterEach(() => vi.restoreAllMocks());

  it("rejects malformed args for every driver before the handler runs", async () => {
    const createMany = vi.spyOn(workspaceService, "createManyFindings");
    await expect(dispatchMainsTool("SaveFindings", { reviewId: "rev_1" }, CTX)).rejects.toThrow("Invalid arguments for SaveFindings");
    await expect(dispatchMainsTool("SaveFindings", { reviewId: "rev_1", findings: [] }, CTX)).rejects.toThrow("Invalid arguments for SaveFindings");
    await expect(dispatchMainsTool("SaveFindings", { reviewId: "rev_1", findings: [{ ...FINDING, severity: "fatal" }] }, CTX)).rejects.toThrow("severity");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("rejects line numbers that are not 1-based integers or are out of order", async () => {
    const createFinding = vi.spyOn(workspaceService, "createFinding");
    for (const lines of [{ lineStart: 0 }, { lineStart: 1.5 }, { lineStart: 10, lineEnd: 4 }]) {
      await expect(dispatchMainsTool("SaveFinding", { reviewId: "rev_1", ...FINDING, ...lines }, CTX)).rejects.toThrow("Invalid arguments for SaveFinding");
    }
    await expect(dispatchMainsTool("SaveFindings", { reviewId: "rev_1", findings: [{ ...FINDING, lineStart: 10, lineEnd: 4 }] }, CTX)).rejects.toThrow("lineEnd");
    expect(createFinding).not.toHaveBeenCalled();
  });

  it("rejects blank and oversized text", async () => {
    await expect(dispatchMainsTool("SaveReview", { title: "   " }, CTX)).rejects.toThrow("Invalid arguments for SaveReview");
    await expect(dispatchMainsTool("SaveFinding", { reviewId: "rev_1", ...FINDING, message: "x".repeat(4001) }, CTX)).rejects.toThrow("message");
  });

  it("hands the handler parsed data", async () => {
    const createReview = vi.spyOn(workspaceService, "createReview").mockResolvedValue("rev_1");
    const result = await dispatchMainsTool("SaveReview", { title: "  Auth review  ", extra: "dropped" }, { ...CTX, workspaceId: null });
    expect(JSON.parse(result.content[0].text)).toEqual({ reviewId: "rev_1" });
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({ title: "Auth review", status: "open" }));
  });

  it("treats missing args as an empty object for zero-arg tools", async () => {
    await expect(dispatchMainsTool("ListVoiceTasks", undefined as never, CTX)).rejects.toThrow("outside the active voice");
  });

  it("keeps the line, batch and required-field rules in the agent-facing JSON Schema", () => {
    const schema = toJsonSchema(SaveFindingsSchema) as any;
    expect(schema.properties.findings.minItems).toBe(1);
    expect(schema.properties.findings.items.properties.lineStart).toMatchObject({ type: "integer", minimum: 1 });
    expect([...schema.required].sort()).toEqual(["findings", "reviewId"]);
  });
});

describe("mains tool registry — CheckPackage", () => {
  afterEach(() => vi.restoreAllMocks());
  const check = (packages: unknown) => dispatchMainsTool("CheckPackage", { packages }, CTX);
  const parse = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text);

  it("reports each package as JSON on one 0–100 scale and warns when one is blocked", async () => {
    vi.spyOn(guardsService, "checkPackages").mockResolvedValue([
      {
        allowed: true, alerts: [], package: { name: "zod", version: "4.0.0", ecosystem: "npm" },
        score: {
          package: { name: "zod", version: "4.0.0", ecosystem: "npm" }, overallScore: 0.92, riskLevel: "low",
          categories: { quality: 0.9, vulnerability: 1 }, alerts: [],
        },
      },
      {
        allowed: false, package: { name: "evil", ecosystem: "pypi" }, reason: "Blocked by policy",
        alerts: [{ type: "malware", severity: "critical", title: "Known malware" }],
      },
    ]);
    const output = parse(await check([{ name: "zod", version: "4.0.0" }, { name: "evil", ecosystem: "pypi" }]));
    expect(output.blocked).toBe(true);
    expect(output.warning).toContain("Do NOT install");
    expect(output.results).toEqual([
      {
        name: "zod", version: "4.0.0", ecosystem: "npm", allowed: true, alerts: [], reason: null,
        score: { overall: 92, riskLevel: "low", categories: { quality: 90, vulnerability: 100 } },
      },
      {
        name: "evil", version: null, ecosystem: "pypi", allowed: false, score: null, reason: "Blocked by policy",
        alerts: [{ severity: "critical", title: "Known malware" }],
      },
    ]);
  });

  it("defaults the ecosystem to npm and stays quiet when nothing is blocked", async () => {
    const checkPackages = vi.spyOn(guardsService, "checkPackages")
      .mockResolvedValue([{ allowed: true, alerts: [], package: { name: "axios", ecosystem: "npm" } }]);
    const output = parse(await check([{ name: "axios" }]));
    expect(checkPackages).toHaveBeenCalledWith([{ name: "axios", version: undefined, ecosystem: "npm" }]);
    expect(output).toMatchObject({ blocked: false });
    expect(output).not.toHaveProperty("warning");
  });

  it("fails by throwing, for an unavailable guard or an empty list", async () => {
    vi.spyOn(guardsService, "checkPackages").mockRejectedValue(new Error("No guard service is connected"));
    await expect(check([{ name: "axios" }])).rejects.toThrow("Guard check failed: No guard service is connected");
    await expect(check([])).rejects.toThrow("Invalid arguments for CheckPackage");
  });
});

describe("mains tool registry — Copilot results", () => {
  afterEach(() => vi.restoreAllMocks());
  const saveReview = () => {
    const spec = toCopilotTools(CTX).find((tool) => tool.name === "mcp__mains__SaveReview")!;
    return (args: unknown) => spec.handler!(args, {} as never);
  };
  const def = () => MAINS_TOOLS.find((tool) => tool.name === "SaveReview")!;

  it("returns every content item as one string", async () => {
    vi.spyOn(def(), "handler").mockResolvedValue({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] });
    expect(await saveReview()({})).toBe("one\ntwo");
  });

  it("marks an isError result as a failure instead of a plain string", async () => {
    vi.spyOn(def(), "handler").mockResolvedValue({ content: [{ type: "text", text: "boom" }], isError: true });
    expect(await saveReview()({})).toEqual({ resultType: "failure", textResultForLlm: "boom", error: "boom" });
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

  it("work exposes Atlas Page tools to Work-capable providers", () => {
    expect(toClaudeTools(CTX, "work").map((tool) => tool.name)).toEqual(["RegisterDeliverable", "AtlasReadPage", "AtlasCreatePage", "AtlasUpdatePage", "AtlasListCovers"]);
    expect(toCopilotTools(CTX, "work")).toHaveLength(0);
    expect(toMcpToolDefs("work")).toHaveLength(0);
    expect(toCodexDynamicTools("work").map((tool) => tool.name)).toEqual(["RegisterDeliverable", "AtlasReadPage", "AtlasCreatePage", "AtlasUpdatePage", "AtlasListCovers"]);
  });

  it("chat exposes only read-only Atlas access", () => {
    expect(toClaudeTools(CTX, "chat").map((tool) => tool.name)).toEqual(["AtlasReadPage"]);
    expect(toCopilotTools(CTX, "chat")).toHaveLength(0);
    expect(toMcpToolDefs("chat")).toHaveLength(0);
    expect(toCodexDynamicTools("chat").map((tool) => tool.name)).toEqual(["AtlasReadPage"]);
  });

  it("every tool's modes list (when present) only names known modes", () => {
    for (const tool of MAINS_TOOLS) {
      for (const mode of tool.modes ?? []) {
        expect(["developer", "work", "chat"]).toContain(mode);
      }
    }
  });
});
