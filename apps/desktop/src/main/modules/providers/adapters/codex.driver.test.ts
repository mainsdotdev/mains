// ─────────────────────────────────────────────────────────────
// Pure-function tests for codex.driver.
//
// The Codex SDK (`codex app-server` subprocess) is not exercised here —
// integration tests would require the real CLI. These tests cover the
// deterministic helpers that translate codex-specific shapes into
// canonical/Mains formats.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  buildCollaborationMode,
  buildCodexReviewTarget,
  buildDeveloperInstructionsParam,
  CODEX_APP_SERVER_PROTOCOL_VERSION,
  CODEX_ARCHIVED_CHAT_MESSAGE,
  isCodexArchivedThreadError,
  isCodexUnavailableThreadError,
  mapPersistedCodexSubAgents,
  mapSandboxMode,
  normalizeCodexResumeError,
  parseCodexReviewFindings,
  relativizeGoalMentions,
} from "./codex.driver";
import { mapImageGenerationLifecycle } from "./codex-event-mapper";
import {
  mapCodexPluginList,
  mapRateLimitResponse,
  mapRateLimitSnapshot,
} from "./codex-capabilities";

describe("codex.driver / generated protocol snapshot", () => {
  it("keeps the runtime contract version aligned with generated bindings", () => {
    const protocolManifest = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "codex-app-server-protocol/generated/manifest.json",
        ),
        "utf8",
      ),
    ) as { cliVersion: string };
    expect(CODEX_APP_SERVER_PROTOCOL_VERSION).toBe(protocolManifest.cliVersion);
  });
});

describe("codex.driver / thread availability errors", () => {
  it("maps an archived-session RPC error to the Mains user-facing message", () => {
    const error = new Error(
      "session 019faaad is archived. Run `codex unarchive 019faaad` to unarchive it first. (code: -32600)",
    );

    expect(isCodexArchivedThreadError(error)).toBe(true);
    expect(isCodexUnavailableThreadError(error)).toBe(true);
    expect(normalizeCodexResumeError(error).message).toBe(
      CODEX_ARCHIVED_CHAT_MESSAGE,
    );
  });

  it("treats a missing thread as unavailable without rewriting its error", () => {
    const error = new Error(
      "thread not found: 019faaad (code: -32600)",
    );

    expect(isCodexArchivedThreadError(error)).toBe(false);
    expect(isCodexUnavailableThreadError(error)).toBe(true);
    expect(normalizeCodexResumeError(error)).toBe(error);
  });

  it("keeps unrelated app-server failures visible", () => {
    const error = new Error("RPC timeout: thread/goal/get (30000ms)");

    expect(isCodexArchivedThreadError(error)).toBe(false);
    expect(isCodexUnavailableThreadError(error)).toBe(false);
    expect(normalizeCodexResumeError(error)).toBe(error);
  });
});

describe("codex.driver / persisted subagent recovery", () => {
  it("recovers a stopped Luna child without treating the generic fallback as its nickname", () => {
    expect(
      mapPersistedCodexSubAgents([
        {
          toolId: "spawn-1",
          metadata: {
            subagent: {
              phase: "stopped",
              agentId: "thread-child",
              agentType: "agent",
              prompt: "Review security risks",
            },
          },
        },
      ]),
    ).toEqual([
      {
        threadId: "thread-child",
        nickname: undefined,
        prompt: "Review security risks",
        spawnItemId: "spawn-1",
        terminalEmitted: true,
        terminalPhase: "stopped",
        lastMessage: undefined,
      },
    ]);
  });
});

describe("codex.driver / mapCodexPluginList", () => {
  it("maps the installed-only wire response without requiring featured ids", () => {
    expect(
      mapCodexPluginList({
        marketplaces: [
          {
            name: "openai-curated-remote",
            path: null,
            interface: { displayName: "OpenAI" },
            plugins: [
              {
                id: "figma@openai-curated-remote",
                name: "figma",
                source: { type: "remote", path: "" },
                installed: true,
                installedAt: 1_700_000_000,
                enabled: true,
                installPolicy: "AVAILABLE",
                availability: "AVAILABLE",
                disabledReason: null,
                eligiblePlanTypes: ["pro"],
                authPolicy: "ON_INSTALL",
                interface: {
                  displayName: "Figma",
                  capabilities: ["apps"],
                  logoUrl: "https://example.com/figma.png",
                  screenshotUrls: ["https://example.com/figma-shot.png"],
                },
              },
            ],
          },
        ],
        marketplaceLoadErrors: [],
        remoteSyncError: null,
      }),
    ).toEqual({
      marketplaces: [
        {
          name: "openai-curated-remote",
          path: "",
          interface: { displayName: "OpenAI" },
          plugins: [
            {
              id: "figma@openai-curated-remote",
              name: "figma",
              source: { type: "remote", path: "" },
              installed: true,
              installedAt: 1_700_000_000,
              enabled: true,
              installPolicy: "AVAILABLE",
              availability: "AVAILABLE",
              disabledReason: null,
              eligiblePlanTypes: ["pro"],
              authPolicy: "ON_INSTALL",
              interface: {
                displayName: "Figma",
                shortDescription: undefined,
                longDescription: undefined,
                developerName: undefined,
                category: undefined,
                capabilities: ["apps"],
                websiteUrl: undefined,
                defaultPrompt: undefined,
                brandColor: undefined,
                composerIcon: undefined,
                logo: "https://example.com/figma.png",
                screenshots: ["https://example.com/figma-shot.png"],
                privacyPolicyUrl: undefined,
                termsOfServiceUrl: undefined,
              },
            },
          ],
        },
      ],
      marketplaceLoadErrors: [],
      remoteSyncError: null,
      featuredPluginIds: [],
    });
  });

  it("returns an empty canonical response for malformed payloads", () => {
    expect(mapCodexPluginList(undefined)).toEqual({
      marketplaces: [],
      marketplaceLoadErrors: [],
      remoteSyncError: null,
      featuredPluginIds: [],
    });
  });
});

describe("codex.driver / mapImageGenerationLifecycle", () => {
  it("opens an ephemeral image-generation stream when the item starts", () => {
    expect(
      mapImageGenerationLifecycle(
        { id: "img-1", status: "inProgress" },
        "start",
        "run-1",
        123,
      ),
    ).toEqual([{
      type: "artifact",
      kind: "image_generation",
      content: "Generating image",
      metadata: {
        source: "codex_image_generation",
        itemId: "img-1",
        status: "inProgress",
      },
      ephemeral: true,
      streamId: "codex-image-generation-run-1-img-1",
      ts: 123,
    }]);
  });

  it("clears the same stream when generation completes", () => {
    expect(
      mapImageGenerationLifecycle(
        { id: "img-1", status: "completed" },
        "complete",
        "run-1",
        456,
      ),
    ).toEqual([{
      type: "artifact",
      kind: "image_generation",
      content: "",
      metadata: {
        source: "codex_image_generation",
        itemId: "img-1",
        status: "completed",
      },
      ephemeral: true,
      streamId: "codex-image-generation-run-1-img-1",
      ts: 456,
    }]);
  });

  it("records a diagnostic error after clearing a failed generation", () => {
    const events = mapImageGenerationLifecycle(
      { id: "img-2", status: "failed" },
      "complete",
      "run-1",
      789,
    );

    expect(events[0]).toMatchObject({
      type: "artifact",
      content: "",
      streamId: "codex-image-generation-run-1-img-2",
    });
    expect(events[1]).toMatchObject({
      type: "log",
      level: "error",
      message: "Codex image generation failed",
    });
  });

  it("ignores intermediate updates because the protocol has no stage progress", () => {
    expect(
      mapImageGenerationLifecycle(
        { id: "img-1", status: "inProgress" },
        "update",
        "run-1",
        234,
      ),
    ).toEqual([]);
  });
});

describe("codex.driver / relativizeGoalMentions", () => {
  const root = "/Users/me/Library/Application Support/mains/worktrees/x/coconut";

  it("rewrites an @<abs path> mention under the root as relative", () => {
    expect(
      relativizeGoalMentions(`refactor @${root}/src/renderer/hooks/use-dark-mode.ts`, root),
    ).toBe("refactor @src/renderer/hooks/use-dark-mode.ts");
  });

  it("leaves mentions outside the workspace root untouched", () => {
    expect(relativizeGoalMentions("see @/etc/hosts now", root)).toBe("see @/etc/hosts now");
  });

  it("handles a trailing-slash root and multiple mentions", () => {
    expect(
      relativizeGoalMentions(`@${root}/a.ts and @${root}/b/c.ts`, root + "/"),
    ).toBe("@a.ts and @b/c.ts");
  });

  it("is a no-op without a root or goal", () => {
    expect(relativizeGoalMentions("@/abs/x.ts", undefined)).toBe("@/abs/x.ts");
    expect(relativizeGoalMentions("", root)).toBe("");
  });
});

describe("codex.driver / mapSandboxMode", () => {
  it("preserves valid sandbox modes", () => {
    expect(mapSandboxMode("read-only")).toBe("read-only");
    expect(mapSandboxMode("workspace-write")).toBe("workspace-write");
    expect(mapSandboxMode("danger-full-access")).toBe("danger-full-access");
  });

  it('defaults to "workspace-write" for unknown / undefined modes', () => {
    expect(mapSandboxMode(undefined)).toBe("workspace-write");
    expect(mapSandboxMode("")).toBe("workspace-write");
    expect(mapSandboxMode("invalid")).toBe("workspace-write");
    expect(mapSandboxMode("READ-ONLY")).toBe("workspace-write"); // case-sensitive
  });
});

describe("codex.driver / mapRateLimitSnapshot", () => {
  it("returns null for a missing snapshot", () => {
    expect(mapRateLimitSnapshot(undefined)).toBeNull();
  });

  it("maps the RateLimitSnapshot wire shape into RateLimitInfo", () => {
    // Mirrors the Codex `account/rateLimits/{read,updated}` payload
    // (RateLimitSnapshot — identical for the pull and push paths).
    const snapshot = {
      limitId: "codex",
      limitName: "Codex",
      planType: "pro",
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1717200000 },
      secondary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: 1717800000 },
      credits: { hasCredits: true, balance: "12.50", unlimited: false },
      rateLimitReachedType: null,
    };

    expect(mapRateLimitSnapshot(snapshot)).toEqual({
      limitId: "codex",
      limitName: "Codex",
      planType: "pro",
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1717200000 },
      secondary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: 1717800000 },
      credits: { hasCredits: true, balance: "12.50", unlimited: false },
    });
  });

  it("omits absent window/credit sub-objects", () => {
    const result = mapRateLimitSnapshot({
      planType: "free",
      primary: { usedPercent: 5 },
    });
    expect(result).toEqual({
      planType: "free",
      primary: { usedPercent: 5, windowDurationMins: undefined, resetsAt: undefined },
      secondary: undefined,
      credits: undefined,
    });
  });

  it("normalizes nullable protocol fields to optional Mains fields", () => {
    expect(mapRateLimitSnapshot({
      planType: null,
      primary: {
        usedPercent: 5,
        windowDurationMins: null,
        resetsAt: null,
      },
      secondary: null,
      credits: {
        hasCredits: false,
        balance: null,
        unlimited: false,
      },
    })).toEqual({
      planType: undefined,
      primary: {
        usedPercent: 5,
        windowDurationMins: undefined,
        resetsAt: undefined,
      },
      secondary: undefined,
      credits: {
        hasCredits: false,
        balance: undefined,
        unlimited: false,
      },
    });
  });

  it("preserves bucket identity and spend-control state", () => {
    expect(mapRateLimitSnapshot({
      limitId: "codex",
      limitName: "Codex",
      planType: "team",
      primary: null,
      secondary: null,
      credits: null,
      individualLimit: {
        limit: "100.00",
        used: "25.00",
        remainingPercent: 75,
        resetsAt: 1717800000,
      },
      spendControlReached: false,
      rateLimitReachedType: "workspace_member_usage_limit_reached",
    })).toEqual({
      limitId: "codex",
      limitName: "Codex",
      planType: "team",
      primary: undefined,
      secondary: undefined,
      credits: undefined,
      individualLimit: {
        limit: "100.00",
        used: "25.00",
        remainingPercent: 75,
        resetsAt: 1717800000,
      },
      spendControlReached: false,
      rateLimitReachedType: "workspace_member_usage_limit_reached",
    });
  });
});

describe("codex.driver / mapRateLimitResponse", () => {
  it("maps all metered buckets and reset-credit details", () => {
    expect(mapRateLimitResponse({
      rateLimits: {
        limitId: "codex",
        limitName: "Codex",
        planType: "pro",
        primary: { usedPercent: 10 },
      },
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          limitName: "Codex",
          planType: "pro",
          primary: { usedPercent: 10 },
        },
        "codex-other": {
          limitId: "codex-other",
          limitName: "Other",
          secondary: { usedPercent: 20 },
        },
      },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [{
          id: "credit-1",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: 1717200000,
          expiresAt: null,
          title: "Reset",
          description: null,
        }],
      },
    })).toMatchObject({
      limitId: "codex",
      primary: { usedPercent: 10 },
      rateLimitsByLimitId: {
        codex: { limitId: "codex", primary: { usedPercent: 10 } },
        "codex-other": {
          limitId: "codex-other",
          secondary: { usedPercent: 20 },
        },
      },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [{
          id: "credit-1",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: 1717200000,
          title: "Reset",
        }],
      },
    });
  });
});

describe("codex.driver / buildDeveloperInstructionsParam", () => {
  it("wraps a mode delta as the top-level developerInstructions param", () => {
    expect(buildDeveloperInstructionsParam("# Work mode rules")).toEqual({
      developerInstructions: "# Work mode rules",
    });
  });

  it("spreads to nothing when there is no delta", () => {
    expect(buildDeveloperInstructionsParam(null)).toEqual({});
    expect(buildDeveloperInstructionsParam(undefined)).toEqual({});
    expect(buildDeveloperInstructionsParam("")).toEqual({});
  });
});

describe("codex.driver / buildCollaborationMode", () => {
  describe("plan disabled, no force reset", () => {
    it("returns undefined when plan is off and forceReset is false", () => {
      expect(buildCollaborationMode(false, "gpt-5", "medium", false)).toBeUndefined();
      expect(buildCollaborationMode(false, undefined, undefined, false)).toBeUndefined();
    });
  });

  describe("plan enabled (new thread, forceReset=false)", () => {
    it('emits mode="plan" with model + medium default effort', () => {
      expect(buildCollaborationMode(true, "gpt-5.4", undefined)).toEqual({
        mode: "plan",
        settings: {
          model: "gpt-5.4",
          reasoning_effort: "medium",
          developer_instructions: null,
        },
      });
    });

    it("forwards explicit effort when provided", () => {
      expect(buildCollaborationMode(true, "gpt-5.4", "high")).toEqual({
        mode: "plan",
        settings: {
          model: "gpt-5.4",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      });
    });

    it("sends no collaboration block when there is no model to name", () => {
      // `settings.model` is required by the app-server. `model: ""` is read as
      // a model name ("The '' model is not supported"), and an absent one is
      // rejected outright ("Invalid request: missing field `model`") — which
      // fails the entire turn/start, not just the mode. Plan mode is dropped
      // for this turn rather than taking the run down with it.
      expect(buildCollaborationMode(true, undefined, "low")).toBeUndefined();
    });
  });

  describe("plan disabled, forceReset=true (continue/fork)", () => {
    it('emits mode="default" to clear stuck plan state', () => {
      expect(buildCollaborationMode(false, "gpt-5.4", "high", true)).toEqual({
        mode: "default",
        settings: {
          model: "gpt-5.4",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      });
    });

    it("uses null reasoning_effort when none supplied (plan-off default)", () => {
      const result = buildCollaborationMode(false, "gpt-5.4", undefined, true);
      expect(result?.settings).toMatchObject({ reasoning_effort: null });
    });

    it("sends no collaboration block on a fork that carries no model", () => {
      // The fork path always asks for this block (forceReset), so it is the one
      // that hits an absent model in practice. Sending none leaves the forked
      // thread on its parent's collaboration mode, which is the intent.
      expect(
        buildCollaborationMode(false, undefined, undefined, true),
      ).toBeUndefined();
    });
  });
});

describe("codex.driver / buildCodexReviewTarget", () => {
  it("maps every review target to the generated app-server shape", () => {
    expect(
      buildCodexReviewTarget({ type: "uncommittedChanges" }),
    ).toEqual({ type: "uncommittedChanges" });
    expect(
      buildCodexReviewTarget({ type: "baseBranch", branch: "main" }),
    ).toEqual({ type: "baseBranch", branch: "main" });
    expect(
      buildCodexReviewTarget({
        type: "commit",
        sha: "abc123",
        title: "Fix protocol",
      }),
    ).toEqual({
      type: "commit",
      sha: "abc123",
      title: "Fix protocol",
    });
    expect(
      buildCodexReviewTarget({
        type: "custom",
        instructions: "Review auth changes",
      }),
    ).toEqual({
      type: "custom",
      instructions: "Review auth changes",
    });
  });

  it("rejects incomplete targets before starting an app-server thread", () => {
    expect(() =>
      buildCodexReviewTarget({ type: "baseBranch" }),
    ).toThrow("A base branch is required");
    expect(() =>
      buildCodexReviewTarget({ type: "commit" }),
    ).toThrow("A commit SHA is required");
    expect(() =>
      buildCodexReviewTarget({ type: "custom" }),
    ).toThrow("Instructions are required");
  });
});

describe("codex.driver / parseCodexReviewFindings", () => {
  it("returns empty array for empty / non-string input", () => {
    expect(parseCodexReviewFindings("")).toEqual([]);
    expect(parseCodexReviewFindings(null as unknown as string)).toEqual([]);
    expect(parseCodexReviewFindings(undefined as unknown as string)).toEqual([]);
  });

  it("returns empty array when no priority markers found", () => {
    expect(parseCodexReviewFindings("This is just plain review text.")).toEqual([]);
  });

  it("parses a single P1 finding with line range", () => {
    const text = `- [P1] Use of any type — src/foo.ts:42-45
  This bypasses the type system. Replace with a concrete type.`;
    expect(parseCodexReviewFindings(text)).toEqual([
      {
        severity: "critical",
        title: "Use of any type",
        file: "src/foo.ts",
        lineStart: 42,
        lineEnd: 45,
        message: "Use of any type",
        reason: "This bypasses the type system. Replace with a concrete type.",
      },
    ]);
  });

  it("maps P1/P2/P3 to critical/warning/info", () => {
    const text = `- [P1] Critical issue — file.ts:1
  Critical desc

- [P2] Warning issue — file.ts:5
  Warning desc

- [P3] Info issue — file.ts:10
  Info desc`;
    const findings = parseCodexReviewFindings(text);
    expect(findings).toHaveLength(3);
    expect(findings[0].severity).toBe("critical");
    expect(findings[1].severity).toBe("warning");
    expect(findings[2].severity).toBe("info");
  });

  it("handles single-line ranges (lineEnd undefined)", () => {
    const text = `- [P2] Single line — src/x.ts:7
  Body`;
    const findings = parseCodexReviewFindings(text);
    expect(findings[0].lineStart).toBe(7);
    expect(findings[0].lineEnd).toBeUndefined();
  });

  it("handles findings with no line numbers", () => {
    const text = `- [P3] No location — src/x.ts
  General feedback`;
    const findings = parseCodexReviewFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].lineStart).toBeUndefined();
    expect(findings[0].lineEnd).toBeUndefined();
    expect(findings[0].file).toBe("src/x.ts");
  });

  it("falls back to title when body is empty", () => {
    const text = `- [P2] Just a title — file.ts:1
`;
    const findings = parseCodexReviewFindings(text);
    expect(findings[0].reason).toBe("Just a title");
  });

  it("skips malformed finding blocks but parses surrounding ones", () => {
    const text = `- [P1] Good finding — file.ts:1
  Good desc

- [P2] Malformed (no separator)

- [P3] Another good one — file.ts:5
  Another desc`;
    const findings = parseCodexReviewFindings(text);
    // Malformed in the middle shouldn't crash parsing of the others
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].file).toBe("file.ts");
  });
});
