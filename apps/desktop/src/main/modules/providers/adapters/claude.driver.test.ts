// ─────────────────────────────────────────────────────────────
// Pure-function tests for claude.driver.
//
// The Claude SDK is loaded via dynamic import and not exercised here —
// integration tests would require the actual @anthropic-ai/claude-agent-sdk.
// These tests cover the permission bridge and deterministic outcome classifier
// without starting a real Claude CLI session.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import {
  buildClaudePermissionModeOptions,
  buildClaudeExecutableOptions,
  buildClaudeSessionIdOptions,
  classifyOutcome,
  createClaudePermissionBridge,
  createClaudeElicitationHandler,
  removeClaudeRuntimeSettings,
  writeClaudeRuntimeSettings,
  mapClaudePluginList,
  mapClaudePluginDetail,
  cleanGeneratedTitle,
  parseSimpleYaml,
  mapTaskMessage,
  mapContextUsageResponse,
  buildFastModeEvent,
  buildAssistantErrorEvent,
  buildContextUsageEvent,
  normalizeSubagentOutput,
  buildSubagentCompletionEvent,
  mapSDKMessage,
  resolveClaudeDefaultModelId,
} from "./claude.driver";
import type { ClaudeTaskIndex, SDKSystemMessage } from "./claude.driver";
import fs from "node:fs";
import {
  ALLOWED_TOOLS_SET,
  DEFAULT_ALLOWED_TOOLS,
} from "./adapter.shared";

const DEFAULT_TIMEOUT = 6_000_000;
const INHERITED_PERMISSION_SETTINGS = {
  permissions: {
    allow: DEFAULT_ALLOWED_TOOLS,
  },
};

describe("claude.driver / resolveClaudeDefaultModelId", () => {
  const sdkModels = [
    { value: "default", description: "Use the default model (currently Claude Opus [1M])" },
    { value: "sonnet", displayName: "Claude Sonnet" },
    { value: "opus", displayName: "Claude Opus" },
    { value: "opus[1m]", displayName: "Claude Opus [1M]" },
  ];

  it("honors a configured default the SDK still offers", () => {
    expect(resolveClaudeDefaultModelId(sdkModels, "sonnet")).toBe("sonnet");
  });

  it("ignores a configured default that never matched an SDK alias", () => {
    // What the v1 seed shipped: an API model id, not a CLI alias. Without the
    // fallback no model got isDefault and the picker silently took list order.
    expect(resolveClaudeDefaultModelId(sdkModels, "claude-opus-4-8")).toBe("opus[1m]");
  });

  it("reads the CLI's own default off the synthetic entry, longest name winning", () => {
    // "Claude Opus" is also a substring of the hint — the [1M] variant must win.
    expect(resolveClaudeDefaultModelId(sdkModels)).toBe("opus[1m]");
  });

  it("falls back to SDK order when there is no synthetic entry", () => {
    expect(
      resolveClaudeDefaultModelId([
        { value: "sonnet", displayName: "Claude Sonnet" },
        { value: "opus", displayName: "Claude Opus" },
      ]),
    ).toBe("sonnet");
  });

  it("falls back to SDK order when the hint names no known model", () => {
    expect(
      resolveClaudeDefaultModelId([
        { value: "default", description: "Use the default model" },
        { value: "sonnet", displayName: "Claude Sonnet" },
      ]),
    ).toBe("sonnet");
  });

  it("still resolves when the synthetic entry is the only model offered", () => {
    expect(resolveClaudeDefaultModelId([{ value: "default" }])).toBe("default");
    expect(resolveClaudeDefaultModelId([])).toBeUndefined();
  });
});

describe("claude.driver / skill frontmatter", () => {
  it("folds multiline YAML descriptions into readable text", () => {
    const parsed = parseSimpleYaml(
      [
        "name: creating-skills",
        "description: >",
        "  Design and build Recursive skills — folder-based extensions that give agents",
        "  specialized knowledge, workflows, and tools.",
        "user-invokable: true",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      name: "creating-skills",
      description:
        "Design and build Recursive skills — folder-based extensions that give agents specialized knowledge, workflows, and tools.",
      "user-invokable": true,
    });
  });

  it("preserves line breaks for literal YAML descriptions", () => {
    const parsed = parseSimpleYaml(
      [
        "name: literal-skill",
        "description: |-",
        "  First line.",
        "  Second line.",
        "disable-model-invocation: false",
      ].join("\n"),
    );

    expect(parsed.description).toBe("First line.\nSecond line.");
    expect(parsed["disable-model-invocation"]).toBe(false);
  });
});

describe("claude.driver / permission mode options", () => {
  it("uses the SDK-matched bundled CLI unless a binary override is explicit", () => {
    expect(buildClaudeExecutableOptions()).toEqual({});
    expect(buildClaudeExecutableOptions(process.execPath)).toEqual({
      pathToClaudeCodeExecutable: process.execPath,
    });
    expect(buildClaudeExecutableOptions(undefined, process.execPath)).toEqual({
      pathToClaudeCodeExecutable: process.execPath,
    });
  });

  it("names a fresh session and a fork, but never a plain resume", () => {
    // Measured: a plain resume plus an id exits the CLI with
    // "--session-id can only be used with --continue or --resume if
    // --fork-session is also specified" — a crash, not a warning.
    const id = "11111111-2222-3333-4444-555555555555";

    expect(buildClaudeSessionIdOptions({ newSessionId: id })).toEqual({ sessionId: id });
    expect(
      buildClaudeSessionIdOptions({
        newSessionId: id,
        resumeSessionId: "source",
        forkSession: true,
      }),
    ).toEqual({ sessionId: id });
    expect(
      buildClaudeSessionIdOptions({ newSessionId: id, resumeSessionId: "source" }),
    ).toEqual({});
    expect(buildClaudeSessionIdOptions({})).toEqual({});
  });

  it("acknowledges bypassPermissions so detached agents can inherit bypass mode", () => {
    expect(buildClaudePermissionModeOptions("bypassPermissions")).toEqual({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      allowedTools: DEFAULT_ALLOWED_TOOLS,
      settings: INHERITED_PERMISSION_SETTINGS,
    });
  });

  it("does not enable dangerous permission skipping for other modes", () => {
    const defaultOptions = buildClaudePermissionModeOptions("default");
    const planOptions = buildClaudePermissionModeOptions("plan");

    expect(defaultOptions).toEqual({
      permissionMode: "default",
      allowedTools: DEFAULT_ALLOWED_TOOLS,
      settings: INHERITED_PERMISSION_SETTINGS,
    });
    expect(planOptions).toEqual({
      permissionMode: "plan",
      allowedTools: DEFAULT_ALLOWED_TOOLS,
      settings: INHERITED_PERMISSION_SETTINGS,
    });
    expect(defaultOptions.allowDangerouslySkipPermissions).toBeUndefined();
    expect(planOptions.allowDangerouslySkipPermissions).toBeUndefined();
  });

  it("keeps the background permission callback attached in bypass mode", () => {
    const canUseTool = vi.fn();

    expect(
      buildClaudePermissionModeOptions("bypassPermissions", canUseTool),
    ).toMatchObject({
      canUseTool,
    });
  });

  it("includes every built-in required by headless workflow agents", () => {
    const options = buildClaudePermissionModeOptions("bypassPermissions");

    expect(options.allowedTools).toEqual(DEFAULT_ALLOWED_TOOLS);
    expect(options.allowedTools).toEqual(
      expect.arrayContaining([
        "Workflow",
        "ToolSearch",
        "WebSearch",
        "WebFetch",
        "StructuredOutput",
      ]),
    );
    expect(options).toMatchObject({
      settings: {
        permissions: {
          allow: DEFAULT_ALLOWED_TOOLS,
        },
      },
    });
  });

  it("materializes and removes a settings snapshot for Workflow inheritance", () => {
    const settings = {
      permissions: {
        allow: ["ToolSearch", "StructuredOutput"],
      },
      ultracode: true,
    };
    const settingsPath = writeClaudeRuntimeSettings(settings);

    try {
      expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toEqual(settings);
      expect(fs.statSync(settingsPath).mode & 0o777).toBe(0o600);
    } finally {
      removeClaudeRuntimeSettings(settingsPath);
    }

    expect(fs.existsSync(settingsPath)).toBe(false);
  });
});

describe("claude.driver / permission bridge", () => {
  it("does not register an in-process PreToolUse hook that Workflow children cannot call", () => {
    const bridge = createClaudePermissionBridge({
      runId: "run-workflow",
      allowedTools: ALLOWED_TOOLS_SET,
      bypassMode: true,
    });

    expect(bridge).toEqual({
      canUseTool: expect.any(Function),
    });
    expect(bridge).not.toHaveProperty("preToolUseHook");
  });

  it("allows a pre-approved tool requested by a background agent through canUseTool", async () => {
    const requestApproval = vi.fn();
    const bridge = createClaudePermissionBridge({
      runId: "run-1",
      allowedTools: new Set(["Read"]),
      bypassMode: false,
      requestApproval,
    });

    await expect(
      bridge.canUseTool(
        "Read",
        { file_path: "/tmp/file.ts" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-1",
          agentID: "background-agent-1",
          requestId: "permission-1",
        },
      ),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { file_path: "/tmp/file.ts" },
      toolUseID: "tool-1",
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("routes a non-allowlisted background tool through the existing approval broker", async () => {
    const requestApproval = vi.fn().mockResolvedValue({
      requestId: "permission-2",
      approved: true,
    });
    const bridge = createClaudePermissionBridge({
      runId: "run-2",
      allowedTools: new Set(),
      bypassMode: false,
      requestApproval,
    });

    await expect(
      bridge.canUseTool(
        "CustomTool",
        { value: 42 },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-2",
          agentID: "background-agent-2",
          requestId: "permission-2",
        },
      ),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { value: 42 },
      toolUseID: "tool-2",
    });
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "permission-2",
        runId: "run-2",
        toolName: "CustomTool",
        toolInput: { value: 42 },
        kind: "tool_approval",
      }),
    );
  });

  it("auto-allows MCP tools while the run is on the default toolset", async () => {
    const requestApproval = vi.fn();
    const bridge = createClaudePermissionBridge({
      runId: "run-mcp-default",
      allowedTools: ALLOWED_TOOLS_SET,
      bypassMode: false,
      requestApproval,
    });

    await expect(
      bridge.canUseTool(
        "mcp__linear__create_issue",
        { title: "Bug" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-mcp-1",
          agentID: "agent-1",
          requestId: "permission-mcp-1",
        },
      ),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { title: "Bug" },
      toolUseID: "tool-mcp-1",
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("stops trusting MCP tools once a mode replaces the toolset", async () => {
    // Chat ships its own allowlist. Without this, an attached filesystem or
    // issue-tracker MCP server would hand the mode's removed write powers back.
    const requestApproval = vi.fn().mockResolvedValue({
      requestId: "permission-mcp-2",
      approved: false,
    });
    const bridge = createClaudePermissionBridge({
      runId: "run-mcp-chat",
      allowedTools: new Set(["Read", "Glob", "Grep"]),
      bypassMode: false,
      restrictedToolset: true,
      requestApproval,
    });

    const decision = await bridge.canUseTool(
      "mcp__filesystem__write_file",
      { path: "/tmp/x", contents: "x" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-mcp-2",
        agentID: "agent-2",
        requestId: "permission-mcp-2",
      },
    );

    expect(decision?.behavior).toBe("deny");
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-mcp-chat",
        toolName: "mcp__filesystem__write_file",
        kind: "tool_approval",
      }),
    );
  });

  it("switches the active SDK session to acceptEdits after the user applies the plan", async () => {
    const requestApproval = vi.fn().mockResolvedValue({
      requestId: "plan-approval-1",
      approved: true,
    });
    const bridge = createClaudePermissionBridge({
      runId: "run-plan",
      allowedTools: ALLOWED_TOOLS_SET,
      bypassMode: false,
      requestApproval,
    });

    await expect(
      bridge.canUseTool(
        "ExitPlanMode",
        { plan: "# Proposed plan" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-plan",
          requestId: "plan-approval-1",
        },
      ),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { plan: "# Proposed plan" },
      updatedPermissions: [
        {
          type: "setMode",
          mode: "acceptEdits",
          destination: "session",
        },
      ],
      toolUseID: "tool-plan",
    });

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "plan-approval-1",
        toolName: "ExitPlanMode",
        kind: "tool_approval",
      }),
    );
  });

  it("cancels a parked broker request when the SDK permission stream aborts", async () => {
    const requestApproval = vi.fn(
      () => new Promise<never>(() => {}),
    );
    const cancelApproval = vi.fn();
    const abortController = new AbortController();
    const bridge = createClaudePermissionBridge({
      runId: "run-aborted-permission",
      allowedTools: new Set(),
      bypassMode: false,
      requestApproval,
      cancelApproval,
    });

    const result = bridge.canUseTool(
      "AskUserQuestion",
      { questions: [{ question: "Continue?" }] },
      {
        signal: abortController.signal,
        toolUseID: "tool-aborted-permission",
        requestId: "permission-aborted",
      },
    );

    await vi.waitFor(() => {
      expect(requestApproval).toHaveBeenCalledOnce();
    });
    abortController.abort();

    await expect(result).resolves.toEqual({
      behavior: "deny",
      message: "Permission request aborted",
      toolUseID: "tool-aborted-permission",
    });
    expect(cancelApproval).toHaveBeenCalledWith("permission-aborted");
  });
});

describe("claude.driver / classifyOutcome", () => {
  describe("success path", () => {
    it("succeeded with normal stop reason", () => {
      expect(
        classifyOutcome({
          stopReason: "end_turn",
          aborted: false,
          timedOut: false,
          timeoutMs: DEFAULT_TIMEOUT,
        }),
      ).toEqual({
        status: "succeeded",
        summary: "Completed successfully",
        stopReason: "end_turn",
        usage: undefined,
      });
    });

    it("succeeded when stopReason is null", () => {
      expect(
        classifyOutcome({
          stopReason: null,
          aborted: false,
          timedOut: false,
          timeoutMs: DEFAULT_TIMEOUT,
        }),
      ).toEqual({
        status: "succeeded",
        summary: "Completed successfully",
        stopReason: undefined,
        usage: undefined,
      });
    });

    it("preserves usage on success", () => {
      const usage = { inputTokens: 100, outputTokens: 50, model: "claude-opus" };
      expect(
        classifyOutcome({
          stopReason: "end_turn",
          usage,
          aborted: false,
          timedOut: false,
          timeoutMs: DEFAULT_TIMEOUT,
        }).usage,
      ).toBe(usage);
    });

    it("does not report success when the terminal tool result was cancelled", () => {
      expect(
        classifyOutcome({
          stopReason: "end_turn",
          aborted: false,
          timedOut: false,
          timeoutMs: DEFAULT_TIMEOUT,
          terminalToolNonExecutionKind: "cancelled",
        }),
      ).toEqual({
        status: "failed",
        summary: "Tool execution was cancelled before the run could complete.",
        stopReason: "end_turn",
        usage: undefined,
      });
    });
  });

  describe("refusal", () => {
    it('failed with refusal summary when stop reason is "refusal"', () => {
      expect(
        classifyOutcome({
          stopReason: "refusal",
          aborted: false,
          timedOut: false,
          timeoutMs: DEFAULT_TIMEOUT,
        }),
      ).toEqual({
        status: "failed",
        summary: "The model declined to fulfill this request.",
        stopReason: "refusal",
        usage: undefined,
      });
    });
  });

  describe("abort path", () => {
    it("canceled when AbortSignal fired (no error)", () => {
      expect(
        classifyOutcome({
          stopReason: null,
          aborted: true,
          timedOut: false,
          timeoutMs: DEFAULT_TIMEOUT,
        }),
      ).toEqual({
        status: "canceled",
        summary: "Run was aborted",
        stopReason: undefined,
        usage: undefined,
      });
    });

    it("canceled when AbortSignal fired even with error message", () => {
      expect(
        classifyOutcome({
          stopReason: null,
          aborted: true,
          timedOut: false,
          errorMessage: "AbortError: aborted",
          timeoutMs: DEFAULT_TIMEOUT,
        }),
      ).toEqual({
        status: "canceled",
        summary: "Run was aborted",
        stopReason: undefined,
        usage: undefined,
      });
    });

    it('canceled when error message includes "aborted" without explicit signal', () => {
      expect(
        classifyOutcome({
          stopReason: null,
          aborted: false,
          timedOut: false,
          errorMessage: "Operation was aborted by upstream",
          timeoutMs: DEFAULT_TIMEOUT,
        }),
      ).toEqual({
        status: "canceled",
        summary: "Run was aborted",
        stopReason: undefined,
        usage: undefined,
      });
    });
  });

  describe("timeout path", () => {
    it("failed with timeout summary when timedOut flag set", () => {
      expect(
        classifyOutcome({
          stopReason: null,
          aborted: true, // timeout aborts the controller too
          timedOut: true,
          timeoutMs: 60_000,
        }),
      ).toEqual({
        status: "failed",
        summary: "Request timed out after 60 seconds.",
        stopReason: undefined,
        usage: undefined,
      });
    });

    it('failed with timeout summary when error message includes "timed out"', () => {
      expect(
        classifyOutcome({
          stopReason: null,
          aborted: false,
          timedOut: false,
          errorMessage: "Request timed out after 30000ms",
          timeoutMs: 30_000,
        }),
      ).toEqual({
        status: "failed",
        summary: "Request timed out after 30 seconds.",
        stopReason: undefined,
        usage: undefined,
      });
    });
  });

  describe("generic failure", () => {
    it("failed with the underlying error message", () => {
      expect(
        classifyOutcome({
          stopReason: null,
          aborted: false,
          timedOut: false,
          errorMessage: "SDK connection lost",
          timeoutMs: DEFAULT_TIMEOUT,
        }),
      ).toEqual({
        status: "failed",
        summary: "SDK connection lost",
        stopReason: undefined,
        usage: undefined,
      });
    });

    it("preserves usage on failure", () => {
      const usage = { inputTokens: 100, outputTokens: 50 };
      expect(
        classifyOutcome({
          stopReason: "tool_use",
          usage,
          aborted: false,
          timedOut: false,
          errorMessage: "boom",
          timeoutMs: DEFAULT_TIMEOUT,
        }),
      ).toMatchObject({
        status: "failed",
        summary: "boom",
        stopReason: "tool_use",
        usage,
      });
    });
  });
});

describe("claude.driver / cleanGeneratedTitle", () => {
  it("returns a clean title unchanged", () => {
    expect(cleanGeneratedTitle("Fix Login Redirect", "goal")).toBe("Fix Login Redirect");
  });

  it("strips surrounding quotes and backticks", () => {
    expect(cleanGeneratedTitle('"Add Dark Mode"', "g")).toBe("Add Dark Mode");
    expect(cleanGeneratedTitle("`Update Icons`", "g")).toBe("Update Icons");
  });

  it('strips a leading "Title:" prefix (case-insensitive)', () => {
    expect(cleanGeneratedTitle("Title: Update Icons", "g")).toBe("Update Icons");
    expect(cleanGeneratedTitle("title:   Refactor Header", "g")).toBe("Refactor Header");
  });

  it("strips trailing sentence punctuation", () => {
    expect(cleanGeneratedTitle("Refactor Header!", "g")).toBe("Refactor Header");
    expect(cleanGeneratedTitle("Why Is This Broken?", "g")).toBe("Why Is This Broken");
  });

  it("keeps only the first line", () => {
    expect(cleanGeneratedTitle("Best Title\nignored explanation here", "g")).toBe("Best Title");
  });

  it("falls back to the goal when the model output is empty or whitespace", () => {
    expect(cleanGeneratedTitle("", "My Goal Here")).toBe("My Goal Here");
    expect(cleanGeneratedTitle("   ", "Fallback Goal")).toBe("Fallback Goal");
  });

  it("caps the result at 50 characters", () => {
    const long = "A".repeat(120);
    expect(cleanGeneratedTitle(long, "goal").length).toBe(50);
  });
});

describe("claude.driver / mapClaudePluginList", () => {
  it("returns an empty response for null inputs", () => {
    expect(mapClaudePluginList(null, null)).toEqual({
      marketplaces: [],
      marketplaceLoadErrors: [],
      remoteSyncError: null,
      featuredPluginIds: [],
    });
  });

  it("groups available plugins under their marketplace and overlays installed state", () => {
    const list = {
      installed: [
        { id: "frontend-design@official", enabled: true, installPath: "/p/fd", scope: "user" },
      ],
      available: [
        {
          pluginId: "frontend-design@official",
          name: "frontend-design",
          description: "UI design helper",
          marketplaceName: "official",
          source: { source: "git-subdir", url: "https://github.com/x/y.git", path: "plugins/fd" },
        },
        {
          pluginId: "api-security@official",
          name: "api-security",
          description: "API scanner",
          marketplaceName: "official",
          source: { source: "git-subdir", url: "https://github.com/a/b.git" },
        },
      ],
    };
    const marketplaces = [
      { name: "official", source: "github", repo: "anthropics/official", installLocation: "/m/official" },
    ];

    const res = mapClaudePluginList(list, marketplaces);
    expect(res.marketplaces).toHaveLength(1);
    const mp = res.marketplaces[0];
    expect(mp).toMatchObject({ name: "official", path: "/m/official", interface: null });
    expect(mp.plugins).toHaveLength(2);

    const fd = mp.plugins.find((p) => p.id === "frontend-design@official")!;
    expect(fd).toMatchObject({
      name: "frontend-design",
      installed: true,
      enabled: true,
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      source: { type: "git-subdir", path: "https://github.com/x/y.git" },
    });
    expect(fd.interface).toMatchObject({ shortDescription: "UI design helper", capabilities: [], screenshots: [] });

    const api = mp.plugins.find((p) => p.id === "api-security@official")!;
    expect(api).toMatchObject({ installed: false, enabled: false });
  });

  it("enriches plugin interface with category/developer/homepage from the catalog", () => {
    const list = {
      available: [
        { pluginId: "fd@official", name: "fd", marketplaceName: "official", source: {} },
      ],
    };
    const catalog = {
      "fd@official": {
        marketplace_entry: {
          displayName: "Front End",
          description: "Catalog description",
          category: "development",
          author: { name: "Anthropic" },
          homepage: "https://example.com",
        },
      },
    };
    const res = mapClaudePluginList(list, [], catalog);
    const p = res.marketplaces[0].plugins[0];
    expect(p.interface).toMatchObject({
      displayName: "Front End",
      category: "development",
      developerName: "Anthropic",
      websiteUrl: "https://example.com",
      shortDescription: "Catalog description",
    });
  });

  it("falls back to the marketplace manifest when the catalog lacks the entry", () => {
    const list = {
      available: [
        { pluginId: "mp-skills@official", name: "mp-skills", marketplaceName: "official", source: {} },
      ],
    };
    const manifests = {
      official: {
        "mp-skills": {
          name: "mp-skills",
          description: "Manifest description",
          author: { name: "Matt Pocock" },
          category: "development",
          homepage: "https://github.com/mattpocock/skills",
        },
      },
    };
    const res = mapClaudePluginList(list, [], {}, {}, manifests);
    expect(res.marketplaces[0].plugins[0].interface).toMatchObject({
      category: "development",
      developerName: "Matt Pocock",
      websiteUrl: "https://github.com/mattpocock/skills",
      shortDescription: "Manifest description",
    });
  });

  it("leaves displayName undefined when the catalog has none (UI humanizes the slug)", () => {
    const res = mapClaudePluginList(
      { available: [{ pluginId: "agent-sdk-dev@official", name: "agent-sdk-dev", source: {} }] },
      [],
    );
    expect(res.marketplaces[0].plugins[0].interface?.displayName).toBeUndefined();
  });

  it("derives the marketplace from the id when none is configured", () => {
    const res = mapClaudePluginList(
      { available: [{ pluginId: "foo@bar", name: "foo", source: {} }] },
      null,
    );
    expect(res.marketplaces.map((m) => m.name)).toContain("bar");
    expect(res.marketplaces[0].plugins[0]).toMatchObject({
      id: "foo@bar",
      source: { type: "git", path: "" },
      interface: null,
    });
  });

  it("surfaces installed plugins absent from the catalog under their id-derived marketplace", () => {
    const res = mapClaudePluginList(
      { installed: [{ id: "local-thing@mine", enabled: false, installPath: "/x" }], available: [] },
      [],
    );
    const mp = res.marketplaces.find((m) => m.name === "mine")!;
    expect(mp.plugins[0]).toMatchObject({
      id: "local-thing@mine",
      name: "local-thing",
      installed: true,
      enabled: false,
      source: { type: "local", path: "/x" },
    });
  });

  it("populates installs and flags updateAvailable from catalog sha vs installed sha", () => {
    const list = {
      installed: [{ id: "p@m", enabled: true }],
      available: [
        { pluginId: "p@m", name: "p", marketplaceName: "m", source: {}, installCount: 2293 },
        { pluginId: "q@m", name: "q", marketplaceName: "m", source: {} },
      ],
    };
    const catalog = { "p@m": { sha: "NEWSHA", unique_installs: 9999 } };
    const res = mapClaudePluginList(list, [], catalog, { "p@m": "OLDSHA" });
    const plugins = res.marketplaces[0].plugins;
    const p = plugins.find((x) => x.id === "p@m")!;
    const q = plugins.find((x) => x.id === "q@m")!;
    expect(p.installs).toBe(2293); // installCount preferred over catalog unique_installs
    expect(p.updateAvailable).toBe(true);
    expect(q.installs).toBeUndefined();
    expect(q.updateAvailable).toBe(false); // not installed
  });

  it("does not flag updateAvailable when the catalog lacks a concrete sha", () => {
    const res = mapClaudePluginList(
      { installed: [{ id: "p@m", enabled: true }], available: [{ pluginId: "p@m", name: "p", source: {} }] },
      [],
      { "p@m": { source_sha: "DIFFERS" } }, // sha absent → unreliable, don't flag
      { "p@m": "INSTALLED" },
    );
    expect(res.marketplaces[0].plugins[0].updateAvailable).toBe(false);
  });
});

describe("claude.driver / mapClaudePluginDetail", () => {
  const catalog = {
    "frontend-design@claude-plugins-official": {
      plugin: "frontend-design",
      components: {
        commands: [],
        agents: [],
        skills: [{ name: "frontend-design", chars: { always_on: 236 } }],
        hooks: [],
        mcpServers: [{ name: "design-mcp" }],
      },
      marketplace_entry: {
        name: "frontend-design",
        description: "Create distinctive frontend interfaces.",
        author: { name: "Anthropic" },
        category: "development",
        homepage: "https://github.com/anthropics/x",
        source: "./plugins/frontend-design",
      },
    },
  };

  it("maps a catalog entry into a PluginDetail with components and installed state", () => {
    const detail = mapClaudePluginDetail(
      catalog,
      { "frontend-design@claude-plugins-official": true },
      "frontend-design",
      "/Users/me/.claude/plugins/marketplaces/claude-plugins-official",
    );

    expect(detail.marketplaceName).toBe("claude-plugins-official");
    expect(detail.description).toBe("Create distinctive frontend interfaces.");
    expect(detail.skills).toEqual([{ name: "frontend-design", enabled: true }]);
    expect(detail.mcpServers).toEqual(["design-mcp"]);
    expect(detail.apps).toEqual([]);
    expect(detail.summary).toMatchObject({
      id: "frontend-design@claude-plugins-official",
      name: "frontend-design",
      installed: true,
      enabled: true,
      installPolicy: "AVAILABLE",
    });
    expect(detail.summary.interface).toMatchObject({
      displayName: "frontend-design",
      developerName: "Anthropic",
      category: "development",
      websiteUrl: "https://github.com/anthropics/x",
    });
  });

  it("marks not-installed plugins and resolves the id by name fallback", () => {
    const detail = mapClaudePluginDetail(catalog, {}, "frontend-design", "");
    expect(detail.summary).toMatchObject({
      id: "frontend-design@claude-plugins-official",
      installed: false,
      enabled: false,
    });
  });

  it("degrades to a minimal detail when the catalog is empty", () => {
    const detail = mapClaudePluginDetail({}, {}, "ghost", "/m/some-market");
    expect(detail.summary.id).toBe("ghost@some-market");
    expect(detail.description).toBeNull();
    expect(detail.skills).toEqual([]);
    expect(detail.mcpServers).toEqual([]);
    expect(detail.summary.interface?.displayName).toBe("ghost");
  });

  it("falls back to the marketplace.json manifest entry when the catalog lacks the plugin", () => {
    const manifestEntry = {
      name: "mattpocock-skills",
      description: "Matt Pocock's agent skills for real engineering.",
      author: { name: "Matt Pocock" },
      category: "development",
      homepage: "https://github.com/mattpocock/skills",
      source: { source: "url", url: "https://github.com/mattpocock/skills.git" },
    };
    const detail = mapClaudePluginDetail(
      {},
      {},
      "mattpocock-skills",
      "/m/claude-plugins-official",
      manifestEntry,
    );

    expect(detail.description).toBe("Matt Pocock's agent skills for real engineering.");
    expect(detail.summary.interface).toMatchObject({
      developerName: "Matt Pocock",
      category: "development",
      websiteUrl: "https://github.com/mattpocock/skills",
    });
    expect(detail.summary.source.path).toBe("https://github.com/mattpocock/skills");
    expect(detail.uniqueInstalls).toBeNull();
    expect(detail.lastUpdated).toBeNull();
  });

  it("prefers catalog fields over the manifest and surfaces installs/lastUpdated", () => {
    const enriched = {
      ...catalog,
      "frontend-design@claude-plugins-official": {
        ...(catalog["frontend-design@claude-plugins-official"] as Record<string, any>),
        unique_installs: 1234,
        last_updated: "2025-12-01T16:03:02-08:00",
      },
    };
    const detail = mapClaudePluginDetail(
      enriched,
      {},
      "frontend-design",
      "/m/claude-plugins-official",
      { name: "frontend-design", author: { name: "Someone Else" }, category: "other" },
    );

    expect(detail.summary.interface).toMatchObject({
      developerName: "Anthropic",
      category: "development",
    });
    expect(detail.uniqueInstalls).toBe(1234);
    expect(detail.lastUpdated).toBe("2025-12-01T16:03:02-08:00");
  });
});

// ─────────────────────────────────────────────────────────────
// Background/foreground task mapping (system:task_* messages).
//
// Payloads mirror what the bundled Claude CLI actually emits: a `sleep`
// backgrounded into a local_bash task, and an Agent subagent task.
// ─────────────────────────────────────────────────────────────

describe("claude.driver / mapTaskMessage", () => {
  const TS = 1_700_000_000_000;

  function sys(msg: Partial<SDKSystemMessage>): SDKSystemMessage {
    return {
      type: "system",
      uuid: "u1",
      session_id: "s1",
      ...msg,
    } as SDKSystemMessage;
  }

  function newIndex(): ClaudeTaskIndex {
    return new Map();
  }

  it("maps task_started and records the tool_use_id anchor", () => {
    const index = newIndex();
    const event = mapTaskMessage(
      sys({
        subtype: "task_started",
        task_id: "bflwfagyw",
        tool_use_id: "toolu_bash",
        description: "sleep 45 && echo finished-ok",
        task_type: "local_bash",
      }),
      index,
      TS,
    );

    expect(event).toMatchObject({
      type: "task",
      phase: "started",
      status: "running",
      taskId: "bflwfagyw",
      toolCallId: "toolu_bash",
      description: "sleep 45 && echo finished-ok",
      taskType: "local_bash",
      ts: TS,
    });
    expect(index.get("bflwfagyw")?.toolUseId).toBe("toolu_bash");
  });

  it("maps task_progress with usage and last tool", () => {
    const index = newIndex();
    mapTaskMessage(
      sys({ subtype: "task_started", task_id: "t1", tool_use_id: "toolu_agent", subagent_type: "general-purpose" }),
      index,
      TS,
    );

    const event = mapTaskMessage(
      sys({
        subtype: "task_progress",
        task_id: "t1",
        tool_use_id: "toolu_agent",
        last_tool_name: "Bash",
        summary: "Counting files",
        usage: { total_tokens: 1200, tool_uses: 3, duration_ms: 4500 },
      }),
      index,
      TS,
    );

    expect(event).toMatchObject({
      phase: "progress",
      status: "running",
      lastToolName: "Bash",
      summary: "Counting files",
      subagentType: "general-purpose",
      usage: { totalTokens: 1200, toolUses: 3, durationMs: 4500 },
    });
  });

  it("resolves task_updated through the index — it carries no tool_use_id", () => {
    const index = newIndex();
    mapTaskMessage(
      sys({ subtype: "task_started", task_id: "t1", tool_use_id: "toolu_agent" }),
      index,
      TS,
    );

    const event = mapTaskMessage(
      sys({
        subtype: "task_updated",
        task_id: "t1",
        patch: { status: "completed", end_time: 1785499819327 },
      }),
      index,
      TS,
    );

    expect(event).toMatchObject({
      phase: "updated",
      status: "completed",
      toolCallId: "toolu_agent",
    });
  });

  it("maps task_notification to the terminal phase and keeps the output file", () => {
    const index = newIndex();
    mapTaskMessage(
      sys({ subtype: "task_started", task_id: "bflwfagyw", tool_use_id: "toolu_bash" }),
      index,
      TS,
    );

    const event = mapTaskMessage(
      sys({
        subtype: "task_notification",
        task_id: "bflwfagyw",
        tool_use_id: "toolu_bash",
        status: "completed",
        summary: "sleep 45 && echo finished-ok",
        output_file: "/tmp/claude-task-bflwfagyw.log",
      }),
      index,
      TS,
    );

    expect(event).toMatchObject({
      phase: "completed",
      status: "completed",
      outputFile: "/tmp/claude-task-bflwfagyw.log",
      toolCallId: "toolu_bash",
    });
    // Terminal: the anchor is released so a recycled id cannot reattach.
    expect(index.has("bflwfagyw")).toBe(false);
  });

  it("surfaces the summary as the error when a task fails", () => {
    const index = newIndex();
    const event = mapTaskMessage(
      sys({
        subtype: "task_notification",
        task_id: "t9",
        tool_use_id: "toolu_x",
        status: "failed",
        summary: "command exited 1",
      }),
      index,
      TS,
    );

    expect(event).toMatchObject({ phase: "completed", status: "failed", error: "command exited 1" });
  });

  it("returns null when the task has no known tool call anchor", () => {
    // task_updated for a task whose start was never seen (e.g. resumed session).
    const event = mapTaskMessage(
      sys({ subtype: "task_updated", task_id: "orphan", patch: { status: "running" } }),
      newIndex(),
      TS,
    );
    expect(event).toBeNull();
  });

  it("returns null without a task_id", () => {
    const event = mapTaskMessage(
      sys({ subtype: "task_started", tool_use_id: "toolu_bash" }),
      newIndex(),
      TS,
    );
    expect(event).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// MCP elicitation bridge. Without a handler the SDK auto-declines every
// request, so these cover the paths that make a request reach the user.
// ─────────────────────────────────────────────────────────────

describe("claude.driver / buildAssistantErrorEvent", () => {
  it("says nothing for a turn that came back clean", () => {
    expect(buildAssistantErrorEvent({}, 1)).toBeNull();
  });

  it("names a failure that would otherwise read as an empty answer", () => {
    // The CLI still emits the assistant message, just with no content and this
    // flag set — so without it an expired login looks like the agent went quiet.
    expect(buildAssistantErrorEvent({ error: "authentication_failed" }, 1)).toEqual({
      type: "log",
      message: "[api] authentication failed — sign in again",
      level: "error",
      ts: 1,
      metadata: { source: "assistant_error", error: "authentication_failed" },
    });
  });

  it("keeps what the CLI retries on its own at warn", () => {
    // An overload resolves itself; an auth failure does not. Reporting both as
    // errors would train the reader to ignore the red ones.
    expect(buildAssistantErrorEvent({ error: "overloaded" }, 1)).toMatchObject({
      level: "warn",
    });
    expect(buildAssistantErrorEvent({ error: "billing_error" }, 1)).toMatchObject({
      level: "error",
    });
  });

  it("collapses a repeat of the same failure", () => {
    // A run can retry an overload many times; one line per attempt buries
    // everything else in the transcript.
    expect(
      buildAssistantErrorEvent({ error: "overloaded", lastError: "overloaded" }, 1),
    ).toBeNull();
    expect(
      buildAssistantErrorEvent({ error: "rate_limit", lastError: "overloaded" }, 1),
    ).not.toBeNull();
  });

  it("yields to the rate-limit notice, which says more", () => {
    // That line carries the scope (five_hour vs seven_day) and the reset time;
    // this one would only restate "rate limited" underneath it.
    expect(
      buildAssistantErrorEvent({ error: "rate_limit", sawRateLimitNotice: true }, 1),
    ).toBeNull();
    // But it is still the only signal when no such notice was emitted.
    expect(buildAssistantErrorEvent({ error: "rate_limit" }, 1)).toMatchObject({
      message: "[api] rate limited",
    });
    // Only rate_limit defers — nothing else has a dedicated line.
    expect(
      buildAssistantErrorEvent({ error: "overloaded", sawRateLimitNotice: true }, 1),
    ).not.toBeNull();
  });

  it("passes an unrecognized code through rather than swallowing it", () => {
    expect(buildAssistantErrorEvent({ error: "some_new_code" }, 1)).toMatchObject({
      message: "[api] some_new_code",
      level: "error",
    });
  });
});

describe("claude.driver / assistant error in the stream", () => {
  it("reports the failure and re-arms once a turn succeeds", () => {
    const cs = makeClaudeSession();
    const failing = {
      type: "assistant",
      uuid: "u1",
      session_id: "s1",
      parent_tool_use_id: null,
      error: "rate_limit",
      message: { role: "assistant", content: [] },
    } as any;

    expect(mapSDKMessage(failing, cs)[0]).toMatchObject({ level: "warn" });
    // Same code again while the episode is still running: silent.
    expect(mapSDKMessage(failing, cs)).toEqual([]);

    // A clean turn ends the episode...
    mapSDKMessage(
      {
        type: "assistant",
        uuid: "u2",
        session_id: "s1",
        parent_tool_use_id: null,
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      } as any,
      cs,
    );
    // ...so the next occurrence is news again.
    expect(mapSDKMessage(failing, cs)[0]).toMatchObject({ level: "warn" });
  });

  it("stays quiet about a rate limit the run already reported", () => {
    // Reproduces the observed order: the rate-limit event lands first, then the
    // turn comes back tagged rate_limit.
    const cs = makeClaudeSession();

    const [notice] = mapSDKMessage(
      {
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
      } as any,
      cs,
    ) as Array<{ message: string }>;
    expect(notice.message).toContain("[rate-limit] Rate limit reached [five_hour]");

    expect(
      mapSDKMessage(
        {
          type: "assistant",
          uuid: "u1",
          session_id: "s1",
          parent_tool_use_id: null,
          error: "rate_limit",
          message: { role: "assistant", content: [] },
        } as any,
        cs,
      ),
    ).toEqual([]);
  });

  it("stays silent while only approaching the limit", () => {
    // `allowed_warning` arrives on every turn once usage is high — twice per
    // message, in warn styling, about something you cannot act on mid-run.
    // Nothing reaches the transcript until the limit actually rejects a turn.
    const cs = makeClaudeSession();

    expect(
      mapSDKMessage(
        {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed_warning",
            rateLimitType: "seven_day",
            utilization: 0.8,
          },
        } as any,
        cs,
      ),
    ).toEqual([]);
    expect(cs.state.sawRateLimitNotice).toBeFalsy();

    // …and with the notice withheld, the turn's own error still speaks up.
    expect(
      mapSDKMessage(
        {
          type: "assistant",
          uuid: "u1",
          session_id: "s1",
          parent_tool_use_id: null,
          error: "rate_limit",
          message: { role: "assistant", content: [] },
        } as any,
        cs,
      ),
    ).toMatchObject([{ message: "[api] rate limited" }]);
  });

  it("names the cause on an api retry", () => {
    const [event] = mapSDKMessage(
      {
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 2000,
        error_status: 529,
        error: "overloaded",
      } as any,
      makeClaudeSession(),
    ) as Array<{ message: string }>;

    expect(event.message).toBe(
      "[api] Request failed: the API is overloaded [HTTP 529] (1/3) — retrying in 2s",
    );
  });
});

describe("claude.driver / buildFastModeEvent", () => {
  it("stays silent when the run never asked for fast mode", () => {
    // The CLI reports `sdk_opt_in_required` on every ordinary run; treating that
    // as a failure would warn users who never touched the button.
    expect(
      buildFastModeEvent(
        { requested: false, state: "off", reason: "sdk_opt_in_required" },
        1,
      ),
    ).toBeNull();
  });

  it("explains a refusal the CLI would otherwise swallow", () => {
    // The measured case: the request is accepted, the run serves at standard
    // speed, and nothing anywhere says so.
    expect(
      buildFastModeEvent(
        { requested: true, state: "off", reason: "extra_usage_disabled" },
        1,
      ),
    ).toEqual({
      type: "log",
      message:
        "[fast-mode] requested but not active — extra usage is turned off for this account",
      level: "warn",
      ts: 1,
      metadata: { source: "fast_mode", state: "off", reason: "extra_usage_disabled" },
    });
  });

  it("names a mid-run cooldown rather than the stale reason", () => {
    expect(
      buildFastModeEvent({ requested: true, state: "cooldown" }, 1),
    ).toMatchObject({
      message: "[fast-mode] requested but not active — paused after a rate limit",
      level: "warn",
    });
  });

  it("still reports when the CLI gives no reason", () => {
    expect(buildFastModeEvent({ requested: true, state: "off" }, 1)).toMatchObject({
      message: "[fast-mode] requested but not active",
      level: "warn",
    });
  });

  it("confirms the happy path once", () => {
    expect(buildFastModeEvent({ requested: true, state: "on" }, 1)).toMatchObject({
      message: "[fast-mode] active",
      level: "info",
    });
  });

  it("repeats nothing while the state holds", () => {
    // init and result both carry it, and a long run sees result more than once.
    expect(
      buildFastModeEvent({ requested: true, state: "off", lastState: "off" }, 1),
    ).toBeNull();
    expect(
      buildFastModeEvent({ requested: true, state: "cooldown", lastState: "on" }, 1),
    ).not.toBeNull();
  });
});

describe("claude.driver / system messages that used to be dropped", () => {
  function logs(msg: Record<string, unknown>) {
    return mapSDKMessage({ type: "system", ...msg } as any, makeClaudeSession()).filter(
      (event) => event.type === "log",
    ) as Array<{ message: string; level?: string; metadata?: Record<string, unknown> }>;
  }

  it("surfaces a model refusal that moved the turn to another model", () => {
    const [event] = logs({
      subtype: "model_refusal_fallback",
      original_model: "claude-opus-5",
      fallback_model: "claude-opus-4-8",
      api_refusal_category: "cyber",
    });

    expect(event.level).toBe("warn");
    expect(event.message).toContain("claude-opus-5 declined (cyber)");
    expect(event.message).toContain("continuing on claude-opus-4-8");
  });

  it("escalates a refusal with nowhere to fall back to", () => {
    const [event] = logs({
      subtype: "model_refusal_no_fallback",
      original_model: "claude-opus-5",
      api_refusal_category: "cyber",
    });

    expect(event.level).toBe("error");
    expect(event.message).toContain("no fallback was available");
  });

  it("surfaces a rule-denied tool call", () => {
    // Denied before canUseTool runs, so no approval dialog ever appears.
    const [event] = logs({
      subtype: "permission_denied",
      tool_name: "Bash",
      decision_reason: "matched deny rule Bash(rm:*)",
    });

    expect(event.level).toBe("warn");
    expect(event.message).toBe("[permission] Bash denied — matched deny rule Bash(rm:*)");
  });

  it("passes an informational notice through at its own level", () => {
    expect(logs({ subtype: "informational", content: "Heads up", level: "warning" })[0])
      .toMatchObject({ message: "Heads up", level: "warn" });
    expect(logs({ subtype: "informational", content: "FYI", level: "info" })[0])
      .toMatchObject({ level: "info" });
  });

  it("keeps only the notifications the CLI marks urgent", () => {
    expect(logs({ subtype: "notification", text: "Ambient", priority: "low" })).toEqual([]);
    expect(logs({ subtype: "notification", text: "Act now", priority: "immediate" })[0])
      .toMatchObject({ message: "[notice] Act now", level: "warn" });
  });

  it("drops CLI bookkeeping instead of logging it", () => {
    // These carry nothing a reader of the transcript can act on.
    expect(logs({ subtype: "thinking_tokens", estimated_tokens: 900 })).toEqual([]);
    expect(logs({ subtype: "session_state_changed", state: "idle" })).toEqual([]);
  });
});

describe("claude.driver / top-level messages that used to be raw JSON", () => {
  function events(msg: Record<string, unknown>) {
    return mapSDKMessage(msg as any, makeClaudeSession());
  }

  it("says nothing for a routine tool heartbeat", () => {
    // One per tick per running tool — this was the loudest line in the transcript.
    expect(events({ type: "tool_progress", tool_use_id: "t1", tool_name: "Bash" })).toEqual(
      [],
    );
  });

  it("reports a subagent quietly retrying", () => {
    const [event] = events({
      type: "tool_progress",
      tool_name: "Agent",
      subagent_retry: { agent_id: "a1", attempt: 2, max_retries: 3, error_category: "overloaded" },
    });

    expect(event).toMatchObject({
      type: "log",
      level: "warn",
      message: "[subagent] retrying Agent (overloaded) — attempt 2/3",
    });
  });

  it("passes a tool-use summary through as prose", () => {
    expect(events({ type: "tool_use_summary", summary: "Read 4 files" })[0]).toMatchObject({
      message: "Read 4 files",
      level: "info",
    });
  });

  it("bounds the dump for a genuinely unknown type", () => {
    const [event] = events({ type: "something_new", blob: "x".repeat(5_000) }) as Array<{
      message: string;
    }>;

    expect(event.message.length).toBeLessThan(600);
    expect(event.message).toContain("[event] something_new");
    expect(event.message.endsWith("…")).toBe(true);
  });
});

describe("claude.driver / mapContextUsageResponse", () => {
  const response = {
    totalTokens: 11_236,
    maxTokens: 200_000,
    percentage: 6,
    model: "claude-haiku-4-5-20251001",
    isAutoCompactEnabled: true,
    autoCompactThreshold: 167_000,
    categories: [
      { name: "System prompt", tokens: 368 },
      { name: "System tools (deferred)", tokens: 13_198, isDeferred: true },
      { name: "Autocompact buffer", tokens: 33_000 },
      { name: "Free space", tokens: 188_679 },
    ],
  };

  it("classifies rows the control reply leaves undiscriminated", () => {
    // Unlike the /context payload, this shape carries no `kind` — deferred rows
    // are flagged and the two space rows are known only by name.
    const event = mapContextUsageResponse(response, 7);

    expect(event).toEqual({
      type: "context_usage",
      totalTokens: 11_236,
      maxTokens: 200_000,
      percentage: 6,
      model: "claude-haiku-4-5-20251001",
      isAutoCompactEnabled: true,
      autoCompactThreshold: 167_000,
      categories: [
        { name: "System prompt", tokens: 368, kind: "used" },
        { name: "System tools (deferred)", tokens: 13_198, kind: "deferred" },
        { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
        { name: "Free space", tokens: 188_679, kind: "free" },
      ],
      ts: 7,
    });
  });

  it("carries the compaction threshold so the meter can mark it", () => {
    // No Claude path supplied this before, so the threshold marker never drew.
    expect(mapContextUsageResponse(response, 7)).toMatchObject({
      isAutoCompactEnabled: true,
      autoCompactThreshold: 167_000,
    });
  });

  it("keeps an unrecognized space row as a plain category", () => {
    // Name matching is the only discriminator available; a rename upstream must
    // not drop the row or its tokens.
    const event = mapContextUsageResponse(
      { ...response, categories: [{ name: "Unused window", tokens: 100 }] },
      7,
    );

    expect(event).toMatchObject({
      categories: [{ name: "Unused window", tokens: 100, kind: "used" }],
    });
  });

  it("returns null without a window to measure against", () => {
    expect(mapContextUsageResponse(null, 7)).toBeNull();
    expect(mapContextUsageResponse({ ...response, maxTokens: 0 }, 7)).toBeNull();
  });
});

describe("claude.driver / buildContextUsageEvent", () => {
  const snapshot = {
    model: "claude-opus-4-8",
    total_tokens: 42_000,
    raw_max_tokens: 200_000,
    percentage: 21,
  };

  it("maps a top-level snapshot onto the meter event", () => {
    expect(
      buildContextUsageEvent({ context_usage: snapshot, parent_tool_use_id: null }, 123),
    ).toEqual({
      type: "context_usage",
      totalTokens: 42_000,
      // The window is the CLI's *resolved autocompact window*, not the model's
      // raw limit — the meter measures against the same boundary `/context` does.
      maxTokens: 200_000,
      percentage: 21,
      model: "claude-opus-4-8",
      ts: 123,
    });
  });

  it("passes an over-limit total through unclamped", () => {
    // total_tokens is documented as unclamped; clamping is the meter's job, and
    // swallowing the overflow here would hide a context overrun.
    const event = buildContextUsageEvent(
      {
        context_usage: { ...snapshot, total_tokens: 210_000, percentage: 105 },
        parent_tool_use_id: null,
      },
      123,
    );
    expect(event).toMatchObject({ totalTokens: 210_000, percentage: 105 });
  });

  it("ignores a subagent's snapshot", () => {
    // A subagent (e.g. haiku) has its own window; letting it through would
    // clobber the main conversation's reading.
    expect(
      buildContextUsageEvent(
        { context_usage: snapshot, parent_tool_use_id: "toolu_parent" },
        123,
      ),
    ).toBeNull();
  });

  it("returns null when the CLI sends no snapshot", () => {
    // Older configured binaries omit the field; the caller falls back to the
    // modelUsage-derived estimate instead.
    expect(buildContextUsageEvent({ parent_tool_use_id: null }, 123)).toBeNull();
  });

  it("returns null when there is no window to measure against", () => {
    expect(
      buildContextUsageEvent(
        { context_usage: { ...snapshot, raw_max_tokens: 0 }, parent_tool_use_id: null },
        123,
      ),
    ).toBeNull();
  });

  it("passes the category partition through as semantic rows", () => {
    // Colors are the renderer's call — the driver ships kinds, never presentation.
    const event = buildContextUsageEvent(
      {
        context_usage: {
          ...snapshot,
          categories: [
            { name: "System prompt", tokens: 12_000, kind: "used" },
            { name: "Free", tokens: 158_000, kind: "free" },
          ],
        },
        parent_tool_use_id: null,
      },
      123,
    );

    expect(event).toMatchObject({
      categories: [
        { name: "System prompt", tokens: 12_000, kind: "used" },
        { name: "Free", tokens: 158_000, kind: "free" },
      ],
    });
  });

  it("drops rows the renderer could not classify", () => {
    // The kinds come off a subprocess; an unknown one has no lane in the meter,
    // and a zero-token row would only render as a minimum-width sliver.
    const event = buildContextUsageEvent(
      {
        context_usage: {
          ...snapshot,
          categories: [
            { name: "Messages", tokens: 12_000, kind: "used" },
            { name: "Mystery", tokens: 5_000, kind: "something_new" },
            { name: "Skills", tokens: 0, kind: "used" },
          ],
        },
        parent_tool_use_id: null,
      },
      123,
    );

    expect(event).toMatchObject({ categories: [{ name: "Messages", kind: "used" }] });
  });

  it("omits the field entirely when nothing survives", () => {
    // An empty array would make the renderer draw an empty legend frame.
    const event = buildContextUsageEvent(
      {
        context_usage: { ...snapshot, categories: [{ name: "x", tokens: 0, kind: "used" }] },
        parent_tool_use_id: null,
      },
      123,
    );

    expect(event).not.toHaveProperty("categories");
  });
});

describe("claude.driver / elicitation handler", () => {
  const FORM_REQUEST = {
    serverName: "linear",
    message: "Provide your workspace credentials",
    mode: "form" as const,
    requestedSchema: {
      properties: { apiKey: { type: "string" } },
      required: ["apiKey"],
    },
  };

  function opts() {
    return { signal: new AbortController().signal };
  }

  it("routes the request to the approval broker as an elicitation", async () => {
    const requestApproval = vi.fn().mockResolvedValue({
      requestId: "x",
      approved: true,
      answer: JSON.stringify({ apiKey: "sk-123" }),
    });
    const handler = createClaudeElicitationHandler({ runId: "run-1", requestApproval });

    await expect(handler(FORM_REQUEST, opts())).resolves.toEqual({
      action: "accept",
      content: { apiKey: "sk-123" },
    });
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        kind: "elicitation",
        serverName: "linear",
        elicitationMode: "form",
        question: "Provide your workspace credentials",
        requestedSchema: FORM_REQUEST.requestedSchema,
      }),
    );
  });

  it("declines when the user dismisses", async () => {
    const handler = createClaudeElicitationHandler({
      runId: "run-1",
      requestApproval: vi.fn().mockResolvedValue({ requestId: "x", approved: false }),
    });
    await expect(handler(FORM_REQUEST, opts())).resolves.toEqual({ action: "decline" });
  });

  // A URL elicitation is a browser round-trip; there is no content to send back.
  it("accepts a url elicitation without content", async () => {
    const handler = createClaudeElicitationHandler({
      runId: "run-1",
      requestApproval: vi.fn().mockResolvedValue({ requestId: "x", approved: true }),
    });
    await expect(
      handler(
        { serverName: "notion", message: "Authenticate", mode: "url", url: "https://x.test" },
        opts(),
      ),
    ).resolves.toEqual({ action: "accept" });
  });

  // Sending content we know is malformed surfaces as an opaque server-side
  // validation error; declining names the real problem.
  it("declines a form accepted without usable content", async () => {
    const handler = createClaudeElicitationHandler({
      runId: "run-1",
      requestApproval: vi
        .fn()
        .mockResolvedValue({ requestId: "x", approved: true, answer: "not json" }),
    });
    await expect(handler(FORM_REQUEST, opts())).resolves.toEqual({ action: "decline" });
  });

  it("drops values MCP cannot express rather than sending them", async () => {
    const handler = createClaudeElicitationHandler({
      runId: "run-1",
      requestApproval: vi.fn().mockResolvedValue({
        requestId: "x",
        approved: true,
        answer: JSON.stringify({ keep: "a", n: 2, flag: true, tags: ["x"], nested: { a: 1 } }),
      }),
    });
    await expect(handler(FORM_REQUEST, opts())).resolves.toEqual({
      action: "accept",
      content: { keep: "a", n: 2, flag: true, tags: ["x"] },
    });
  });

  it("cancels immediately when the signal is already aborted", async () => {
    const requestApproval = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const handler = createClaudeElicitationHandler({ runId: "run-1", requestApproval });

    await expect(handler(FORM_REQUEST, { signal: controller.signal })).resolves.toEqual({
      action: "cancel",
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  // A control stream can close while a dialog is parked; the broker entry has to
  // be released too or the renderer keeps a dialog nothing will ever answer.
  it("releases the broker entry when aborted mid-request", async () => {
    const controller = new AbortController();
    const cancelApproval = vi.fn();
    const handler = createClaudeElicitationHandler({
      runId: "run-1",
      requestApproval: () => new Promise(() => {}),
      cancelApproval,
    });

    const pending = handler(FORM_REQUEST, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ action: "cancel" });
    expect(cancelApproval).toHaveBeenCalledTimes(1);
  });
});

describe("normalizeSubagentOutput", () => {
  it("joins text blocks and strips the SDK's bookkeeping block", () => {
    const { text, agentId } = normalizeSubagentOutput([
      { type: "text", text: "## Security Review\n\nNo genuine findings." },
      {
        type: "text",
        text: "agentId: a5568de99bd93dcf5 (use SendMessage to continue)\nsubagent_tokens: 90281",
      },
    ]);

    expect(text).toBe("## Security Review\n\nNo genuine findings.");
    expect(agentId).toBe("a5568de99bd93dcf5");
  });

  it("passes plain string output through, still extracting the agentId", () => {
    const { text, agentId } = normalizeSubagentOutput(
      "All done.\nagentId: abcdef123456 inline mention",
    );
    expect(text).toContain("All done.");
    expect(agentId).toBe("abcdef123456");
  });

  it("stringifies non-block objects instead of dropping them", () => {
    const { text } = normalizeSubagentOutput({ some: "object" });
    expect(text).toContain("some");
  });

  it("returns undefined text for empty output", () => {
    expect(normalizeSubagentOutput(undefined).text).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Subagent event sequence (spawn → children → ack/result)
// ─────────────────────────────────────────────────────────────

function makeClaudeSession(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    options: {},
    abortController: new AbortController(),
    fastModeRequested: false,
    ...overrides,
    state: { hasAssistantContent: false },
    toolCallIndex: new Map(),
    taskIndex: new Map(),
    partialTextBuffers: new Map(),
    partialThinkingBuffers: new Map(),
    isInitial: true,
  } as any;
}

describe("buildSubagentCompletionEvent", () => {
  it("treats a launch ack as still-running, not completion", () => {
    const event = buildSubagentCompletionEvent({
      input: { subagent_type: "general-purpose" },
      output: [
        { type: "text", text: "Async agent launched successfully. (This tool result is internal.)" },
        { type: "text", text: "agentId: abc123def456 (use SendMessage to continue)" },
      ],
      toolUseId: "toolu_1",
      ts: 1000,
    }) as any;

    expect(event.phase).toBe("running");
    expect(event.result).toBeUndefined();
    expect(event.agentId).toBe("abc123def456");
  });

  it("trusts the structured run_in_background flag over the ack prose", () => {
    const event = buildSubagentCompletionEvent({
      input: { subagent_type: "general-purpose", run_in_background: true },
      // Hypothetical future SDK wording that no longer matches the regex.
      output: [{ type: "text", text: "Agent dispatched to background." }],
      toolUseId: "toolu_1",
      ts: 1000,
    }) as any;

    expect(event.phase).toBe("running");
  });

  it("flattens a real completion into result text", () => {
    const event = buildSubagentCompletionEvent({
      input: { subagent_type: "general-purpose" },
      output: [
        { type: "text", text: "## Review\n\nNo findings." },
        { type: "text", text: "agentId: abc123 (use SendMessage)" },
      ],
      toolUseId: "toolu_1",
      ts: 1000,
    }) as any;

    expect(event.phase).toBe("completed");
    expect(event.result).toBe("## Review\n\nNo findings.");
  });

  it("maps an errored tool_result to failed", () => {
    const event = buildSubagentCompletionEvent({
      input: { subagent_type: "general-purpose" },
      output: "boom",
      error: "boom",
      toolUseId: "toolu_1",
      ts: 1000,
    }) as any;

    expect(event.phase).toBe("failed");
    expect(event.error).toBe("boom");
  });
});

describe("mapSDKMessage subagent sequence", () => {
  it("tags a subagent's child tool call with its parent and spawn origin", () => {
    const cs = makeClaudeSession();
    const events = mapSDKMessage(
      {
        type: "assistant",
        uuid: "u1",
        session_id: "s1",
        parent_tool_use_id: "toolu_parent",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_child", name: "Read", input: { file_path: "a.ts" } },
          ],
        },
      } as any,
      cs,
    );

    const child = events.find((e) => e.type === "tool_call") as any;
    expect(child?.metadata).toMatchObject({
      phase: "start",
      toolCallId: "toolu_child",
      parentToolUseId: "toolu_parent",
      isFromSubagent: true,
    });
  });

  it("emits invoked on the Agent tool_use and running on its launch ack", () => {
    const cs = makeClaudeSession();
    const spawnEvents = mapSDKMessage(
      {
        type: "assistant",
        uuid: "u1",
        session_id: "s1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_agent",
              name: "Agent",
              input: { subagent_type: "general-purpose", description: "Security review" },
            },
          ],
        },
      } as any,
      cs,
    );
    expect(spawnEvents).toContainEqual(
      expect.objectContaining({ type: "subagent", phase: "invoked", parentToolUseId: "toolu_agent" }),
    );

    const ackEvents = mapSDKMessage(
      {
        type: "user",
        session_id: "s1",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_agent",
              content: [
                { type: "text", text: "Async agent launched successfully." },
                { type: "text", text: "agentId: abc123 (use SendMessage)" },
              ],
            },
          ],
        },
      } as any,
      cs,
    );

    expect(ackEvents).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "running",
        parentToolUseId: "toolu_agent",
        agentId: "abc123",
      }),
    );
    expect(
      ackEvents.filter((e) => e.type === "subagent" && (e as any).phase === "completed"),
    ).toHaveLength(0);
  });
});

describe("claude.driver / buildClaudePermissionModeOptions with a tool policy", () => {
  it("removes disallowed tools from the effective allowlist and denies them", () => {
    const options = buildClaudePermissionModeOptions("acceptEdits", undefined, {
      allowedTools: null,
      disallowedTools: ["Bash"],
    });

    expect(options.allowedTools).not.toContain("Bash");
    expect(options.allowedTools).toEqual(
      DEFAULT_ALLOWED_TOOLS.filter((t) => t !== "Bash"),
    );
    expect(options.disallowedTools).toEqual(["Bash"]);
    const settings = options.settings as {
      permissions: { allow: string[]; deny?: string[] };
    };
    expect(settings.permissions.allow).not.toContain("Bash");
    expect(settings.permissions.deny).toEqual(["Bash"]);
  });

  it("replaces the allowlist wholesale when the policy provides one", () => {
    const options = buildClaudePermissionModeOptions("default", undefined, {
      allowedTools: ["Read", "Glob", "Grep"],
      disallowedTools: ["Bash", "Write", "Edit"],
    });

    expect(options.allowedTools).toEqual(["Read", "Glob", "Grep"]);
    expect(options.disallowedTools).toEqual(["Bash", "Write", "Edit"]);
  });

  it("stays byte-identical to today without a policy", () => {
    expect(buildClaudePermissionModeOptions("default", undefined, null)).toEqual(
      buildClaudePermissionModeOptions("default"),
    );
    expect(buildClaudePermissionModeOptions("default").disallowedTools).toBeUndefined();
  });
});
