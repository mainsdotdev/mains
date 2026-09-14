#!/usr/bin/env node

import fs from "node:fs";
import readline from "node:readline";
import process from "node:process";
import { setTimeout } from "node:timers";

const fixtureCliVersion =
  process.env.MAINS_CODEX_FIXTURE_VERSION ?? "0.147.0";

if (process.argv.includes("--version")) {
  process.stdout.write(`codex-cli ${fixtureCliVersion}\n`);
  process.exit(0);
}

const logPath = process.env.MAINS_CODEX_FIXTURE_LOG;
let nextThreadId = 1;

function log(message) {
  if (!logPath) return;
  fs.appendFileSync(logPath, `${JSON.stringify(message)}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fixtureResponseModel(params) {
  return params.model ?? "gpt-fixture-codex";
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function fixturePluginSummary(overrides = {}) {
  const disabledReason =
    process.env.MAINS_CODEX_FIXTURE_PLUGIN_DISABLED_REASON ?? null;
  return {
    id: "fixture-plugin@fixture-remote",
    remotePluginId: "remote-fixture-plugin-id",
    version: "2.0.0",
    localVersion: null,
    name: "fixture-plugin",
    shareContext: null,
    source: { type: "remote", path: "" },
    installed: false,
    installedAt: null,
    enabled: false,
    installPolicy: "AVAILABLE",
    installPolicySource: null,
    mustShowInstallationInterstitial: false,
    authPolicy: "ON_INSTALL",
    availability:
      disabledReason === "disabled_by_admin"
        ? "DISABLED_BY_ADMIN"
        : "AVAILABLE",
    disabledReason,
    eligiblePlanTypes:
      disabledReason === "plan_not_eligible"
        ? ["pro", "business"]
        : null,
    interface: {
      displayName: "Fixture Plugin",
      shortDescription: "Fixture remote plugin",
      longDescription: "A remote plugin served by the app-server fixture.",
      developerName: "Mains",
      category: "testing",
      capabilities: ["apps", "skills"],
      websiteUrl: "https://example.com/fixture-plugin",
      privacyPolicyUrl: null,
      termsOfServiceUrl: null,
      defaultPrompt: ["Use the fixture plugin"],
      brandColor: "#ff8800",
      composerIcon: null,
      composerIconUrl: "https://example.com/fixture-composer.png",
      logo: null,
      logoDark: null,
      logoUrl: "https://example.com/fixture-logo.png",
      logoUrlDark: null,
      screenshots: [],
      screenshotUrls: ["https://example.com/fixture-shot.png"],
    },
    keywords: ["fixture", "test"],
    ...overrides,
  };
}

function fixturePluginCatalog() {
  return {
    marketplaces: [{
      name: "fixture-remote",
      path: null,
      interface: { displayName: "Fixture Marketplace" },
      plugins: [fixturePluginSummary()],
    }],
    marketplaceLoadErrors: [],
    featuredPluginIds: ["fixture-plugin@fixture-remote"],
  };
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on("line", (line) => {
  if (!line.trim()) return;

  const message = JSON.parse(line);
  log(message);

  if (!("method" in message) || !("id" in message)) return;

  const { id, method, params = {} } = message;
  if (process.env.MAINS_CODEX_FIXTURE_HANG_METHOD === method) return;

  switch (method) {
    case "initialize":
      respond(
        id,
        process.env.MAINS_CODEX_FIXTURE_LEGACY_INITIALIZE === "1"
          ? { userAgent: "mains-test-codex-app-server" }
          : {
              userAgent: "mains-test-codex-app-server",
              codexHome: "/tmp/mains-test-codex-home",
              platformFamily: "unix",
              platformOs: "macos",
            },
      );
      break;

    case "thread/start": {
      const threadId = `thread-${nextThreadId++}`;
      respond(id, {
        model: fixtureResponseModel(params),
        thread: {
          id: threadId,
          preview: "",
          modelProvider: "openai",
          createdAt: 1,
          updatedAt: 1,
          status: { type: "idle" },
          path: null,
          cwd: params.cwd,
          cliVersion: fixtureCliVersion,
          ephemeral: false,
          section: null,
          sectionEnteredAt: null,
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: [],
        },
      });
      break;
    }

    case "thread/resume":
      respond(id, {
        model: fixtureResponseModel(params),
        thread: {
          id: params.threadId,
          preview: "",
          modelProvider: "openai",
          createdAt: 1,
          updatedAt: 1,
          status: { type: "idle" },
          path: null,
          cwd: params.cwd,
          cliVersion: fixtureCliVersion,
          ephemeral: false,
          section: null,
          sectionEnteredAt: null,
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: [],
        },
      });
      break;

    case "thread/fork": {
      const threadId = `${params.threadId}-fork`;
      respond(id, {
        model: fixtureResponseModel(params),
        thread: {
          id: threadId,
          preview: "",
          modelProvider: "openai",
          createdAt: 1,
          updatedAt: 1,
          status: { type: "idle" },
          path: null,
          cwd: params.cwd,
          cliVersion: fixtureCliVersion,
          ephemeral: false,
          section: null,
          sectionEnteredAt: null,
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: [],
        },
      });
      break;
    }

    case "turn/start": {
      const turnId = `turn-${params.threadId}`;
      const prompt = Array.isArray(params.input)
        ? params.input.find((item) => item?.type === "text")?.text ?? ""
        : "";
      if (prompt.includes("crash before response")) {
        setTimeout(() => process.exit(17), 10);
        break;
      }
      respond(id, {
        turn: {
          id: turnId,
          items: [],
          status: "inProgress",
          error: null,
        },
      });
      setTimeout(() => {
        notify("turn/started", {
          threadId: params.threadId,
          turn: { id: turnId, items: [], status: "inProgress", error: null },
        });
        if (prompt.includes("active subagent")) {
          const childThreadId = `${params.threadId}-child`;
          notify("thread/started", {
            thread: {
              id: childThreadId,
              parentThreadId: params.threadId,
              agentNickname: "Scout",
              agentRole: "worker",
            },
          });
          notify("item/completed", {
            threadId: params.threadId,
            turnId,
            item: {
              id: `spawn-${childThreadId}`,
              type: "subAgentActivity",
              kind: "started",
              agentThreadId: childThreadId,
              agentPath: "/root/scout",
            },
          });
          notify("turn/started", {
            threadId: childThreadId,
            turn: {
              id: `turn-${childThreadId}`,
              items: [],
              status: "inProgress",
              error: null,
            },
          });
        }
        if (prompt.includes("<mains_interrupted_subagents>")) {
          const childThreadId = `${params.threadId}-child`;
          const childTurnId = `turn-${childThreadId}-continued`;
          notify("item/completed", {
            threadId: params.threadId,
            turnId,
            item: {
              id: `resume-${childThreadId}`,
              type: "collabAgentToolCall",
              tool: "resumeAgent",
              status: "completed",
              senderThreadId: params.threadId,
              receiverThreadIds: [childThreadId],
              agentsStates: {
                [childThreadId]: { status: "running", message: null },
              },
            },
          });
          notify("turn/started", {
            threadId: childThreadId,
            turn: {
              id: childTurnId,
              items: [],
              status: "inProgress",
              error: null,
            },
          });
          notify("item/completed", {
            threadId: childThreadId,
            turnId: childTurnId,
            item: {
              id: `message-${childThreadId}-continued`,
              type: "agentMessage",
              text: "Continued child result",
            },
          });
          notify("turn/completed", {
            threadId: childThreadId,
            turn: {
              id: childTurnId,
              items: [],
              status: "completed",
              error: null,
            },
          });
        }
        if (prompt.includes("subagent completion")) {
          const childThreadId = `${params.threadId}-child`;
          notify("thread/started", {
            thread: {
              id: childThreadId,
              parentThreadId: params.threadId,
              agentNickname: "Scout",
              agentRole: "worker",
            },
          });
          notify("turn/completed", {
            threadId: childThreadId,
            turn: {
              id: `turn-${childThreadId}`,
              items: [],
              status: "completed",
              error: null,
            },
          });
        }
        if (prompt.includes("duplicate completion")) {
          notify("item/agentMessage/delta", {
            threadId: params.threadId,
            turnId,
            itemId: `message-${params.threadId}`,
            delta: "Final answer",
          });
        }
        if (prompt.includes("parallel")) {
          notify("item/agentMessage/delta", {
            threadId: params.threadId,
            turnId,
            itemId: `message-${params.threadId}`,
            delta: prompt,
          });
        }
        if (prompt.includes("parallel plan")) {
          notify("turn/plan/updated", {
            turnId,
            explanation: `Working on ${prompt}`,
            plan: [{
              step: prompt,
              status: "inProgress",
            }],
          });
        }
        if (prompt.includes("ask user")) {
          send({
            jsonrpc: "2.0",
            id: 900,
            method: "item/tool/requestUserInput",
            params: {
              threadId: params.threadId,
              turnId,
              itemId: "question-1",
              autoResolutionMs: 60_000,
              questions: [{
                id: "confirm",
                header: "Confirm",
                question: "Proceed with the plan?",
                isOther: true,
                isSecret: true,
                options: [{
                  label: "Yes",
                  description: "Continue the plan.",
                }],
              }],
            },
          });
        }
        if (prompt.includes("network approval")) {
          send({
            jsonrpc: "2.0",
            id: 902,
            method: "item/commandExecution/requestApproval",
            params: {
              threadId: params.threadId,
              turnId,
              itemId: "network-command-1",
              startedAtMs: Date.now(),
              environmentId: null,
              reason: "Network access is required.",
              networkApprovalContext: {
                host: "api.example.com",
                protocol: "https",
              },
              command: null,
              cwd: null,
              commandActions: null,
              proposedExecpolicyAmendment: null,
              proposedNetworkPolicyAmendments: [{
                host: "api.example.com",
                action: "allow",
              }],
            },
          });
        }
        if (prompt.includes("mcp required form")) {
          send({
            jsonrpc: "2.0",
            id: 903,
            method: "mcpServer/elicitation/request",
            params: {
              threadId: params.threadId,
              turnId,
              serverName: "calendar",
              mode: "form",
              _meta: null,
              message: "Choose a calendar.",
              requestedSchema: {
                type: "object",
                properties: {
                  calendarId: { type: "string" },
                },
                required: ["calendarId"],
              },
            },
          });
        }
        if (prompt.includes("current time")) {
          send({
            jsonrpc: "2.0",
            id: 904,
            method: "currentTime/read",
            params: {
              threadId: params.threadId,
              turnId,
            },
          });
        }
        notify("thread/tokenUsage/updated", {
          threadId: params.threadId,
          turnId,
          tokenUsage: {
            total: {
              totalTokens: 15,
              inputTokens: 10,
              cachedInputTokens: 2,
              cacheWriteInputTokens: 1,
              outputTokens: 5,
              reasoningOutputTokens: 1,
            },
            last: {
              totalTokens: 15,
              inputTokens: 10,
              cachedInputTokens: 2,
              cacheWriteInputTokens: 1,
              outputTokens: 5,
              reasoningOutputTokens: 1,
            },
            modelContextWindow: 1000,
          },
        });
        if (
          !prompt.includes("ask user") &&
          !prompt.includes("parallel") &&
          !prompt.includes("timeout turn") &&
          !prompt.includes("active subagent") &&
          !prompt.includes("subagent completion")
        ) {
          notify("turn/completed", {
            threadId: params.threadId,
            turn: { id: turnId, items: [], status: "completed", error: null },
          });
          if (prompt.includes("duplicate completion")) {
            notify("turn/completed", {
              threadId: params.threadId,
              turn: {
                id: turnId,
                items: [],
                status: "completed",
                error: null,
              },
            });
          }
        }
      }, 10);
      if (prompt.includes("ask user")) {
        setTimeout(() => {
          notify("turn/completed", {
            threadId: params.threadId,
            turn: { id: turnId, items: [], status: "completed", error: null },
          });
        }, 30);
      }
      if (prompt.includes("parallel")) {
        setTimeout(() => {
          notify("turn/completed", {
            threadId: params.threadId,
            turn: { id: turnId, items: [], status: "completed", error: null },
          });
        }, prompt.includes("slow") ? 80 : 30);
      }
      if (prompt.includes("subagent completion")) {
        setTimeout(() => {
          notify("turn/completed", {
            threadId: params.threadId,
            turn: {
              id: turnId,
              items: [],
              status: "completed",
              error: null,
            },
          });
        }, 70);
      }
      if (prompt.includes("late permission")) {
        setTimeout(() => {
          send({
            jsonrpc: "2.0",
            id: 901,
            method: "item/permissions/requestApproval",
            params: {
              threadId: params.threadId,
              turnId,
              itemId: "permission-1",
              environmentId: null,
              permissions: { network: { enabled: true } },
              reason: "Late request",
            },
          });
        }, 25);
      }
      break;
    }

    case "turn/interrupt":
      notify("turn/completed", {
        threadId: params.threadId,
        turn: {
          id: params.turnId,
          items: [],
          status: "interrupted",
          error: null,
        },
      });
      respond(id, {});
      break;

    case "review/start": {
      const reviewThreadId =
        params.delivery === "detached"
          ? `${params.threadId}-review`
          : params.threadId;
      const turnId = `review-turn-${reviewThreadId}`;
      respond(id, {
        reviewThreadId,
        turn: {
          id: turnId,
          items: [],
          status: "inProgress",
          error: null,
        },
      });
      setTimeout(() => {
        notify("turn/started", {
          threadId: reviewThreadId,
          turn: { id: turnId, items: [], status: "inProgress", error: null },
        });
        notify("item/agentMessage/delta", {
          threadId: reviewThreadId,
          turnId,
          itemId: `review-message-${reviewThreadId}`,
          delta: "Review complete.",
        });
        notify("turn/completed", {
          threadId: reviewThreadId,
          turn: { id: turnId, items: [], status: "completed", error: null },
        });
      }, 10);
      break;
    }

    case "thread/unsubscribe":
      respond(id, { status: "unsubscribed" });
      break;

    case "thread/archive":
    case "thread/delete":
      respond(id, {});
      break;

    case "thread/unarchive":
      respond(id, { thread: { id: params.threadId } });
      break;

    case "experimentalFeature/list":
      respond(id, {
        data: [{
          name: "plugins",
          stage: "stable",
          displayName: null,
          description: null,
          announcement: null,
          enabled: process.env.MAINS_CODEX_FIXTURE_PLUGINS_ENABLED !== "0",
          defaultEnabled: true,
        }],
        nextCursor: null,
      });
      break;

    case "account/read":
      respond(id, {
        account: process.env.MAINS_CODEX_FIXTURE_ACCOUNT === "bedrock"
          ? {
              type: "amazonBedrock",
              usesCodexManagedCredentials: true,
            }
          : {
              type: "chatgpt",
              email: "codex@example.com",
              planType: "pro",
            },
        requiresOpenaiAuth: false,
      });
      break;

    case "account/rateLimits/read":
      respond(id, {
        rateLimits: {
          limitId: "codex",
          limitName: "Codex",
          primary: {
            usedPercent: 10,
            windowDurationMins: 300,
            resetsAt: 1717200000,
          },
          secondary: null,
          credits: null,
          individualLimit: null,
          spendControlReached: false,
          planType: "pro",
          rateLimitReachedType: null,
        },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            limitName: "Codex",
            primary: {
              usedPercent: 10,
              windowDurationMins: 300,
              resetsAt: 1717200000,
            },
            secondary: null,
            credits: null,
            individualLimit: null,
            spendControlReached: false,
            planType: "pro",
            rateLimitReachedType: null,
          },
        },
        rateLimitResetCredits: {
          availableCount: 1,
          credits: null,
        },
      });
      break;

    case "model/list":
      respond(id, {
        data: process.env.MAINS_CODEX_FIXTURE_EMPTY_MODELS === "1" ? [] : [{
          id: "gpt-fixture-codex",
          model: "gpt-fixture-codex",
          upgrade: null,
          upgradeInfo: null,
          availabilityNux: null,
          displayName: "GPT Fixture Codex",
          description: "Fixture model for capability integration tests.",
          hidden: false,
          supportedReasoningEfforts: [{
            reasoningEffort: "medium",
            description: "Balanced fixture reasoning.",
          }],
          defaultReasoningEffort: "medium",
          inputModalities: ["text", "image"],
          supportsPersonality: true,
          additionalSpeedTiers: [],
          serviceTiers: [{
            id: "fast",
            name: "Fast",
            description: "Priority fixture service.",
          }],
          defaultServiceTier: null,
          isDefault: true,
        }],
        nextCursor: null,
      });
      break;

    case "skills/list":
      respond(id, {
        data: [{
          cwd: params.cwds?.[0] ?? process.cwd(),
          skills: [{
            name: "fixture-skill",
            description: "Fixture skill description.",
            shortDescription: "Fixture skill",
            interface: {
              displayName: "Fixture Skill",
              shortDescription: "Fixture skill",
              iconSmall: null,
              iconLarge: null,
              brandColor: "#ff8800",
              defaultPrompt: "Use the fixture skill",
            },
            path: "/tmp/fixture-skill/SKILL.md",
            scope: "repo",
            enabled: true,
          }],
          errors: [],
        }],
      });
      break;

    case "plugin/list":
      respond(id, {
        ...fixturePluginCatalog(),
        remoteSyncError: null,
      });
      break;

    case "plugin/installed":
      // Real Codex answers this from a registry snapshotted at process start,
      // so a plugin installed mid-session stays missing until a restart. Set
      // the flag to reproduce that blind spot.
      if (process.env.MAINS_CODEX_FIXTURE_STALE_INSTALLED === "1") {
        respond(id, {
          ...fixturePluginCatalog(),
          marketplaces: [],
        });
        break;
      }
      respond(id, {
        ...fixturePluginCatalog(),
        marketplaces: fixturePluginCatalog().marketplaces.map(
          (marketplace) => ({
            ...marketplace,
            plugins: marketplace.plugins.map((plugin) =>
              fixturePluginSummary({
                ...plugin,
                installed: true,
                enabled: true,
                localVersion: "2.0.0",
              })
            ),
          }),
        ),
      });
      break;

    case "plugin/read":
      respond(id, {
        plugin: {
          marketplaceName: "fixture-remote",
          marketplacePath: null,
          summary: fixturePluginSummary(),
          shareUrl: null,
          description: "Fixture plugin detail.",
          skills: [{
            name: "fixture-plugin-skill",
            description: "Fixture plugin skill.",
            shortDescription: "Plugin skill",
            interface: {
              displayName: "Fixture Plugin Skill",
              shortDescription: "Plugin skill",
            },
            path: null,
            enabled: true,
          }],
          hooks: [],
          apps: [{
            id: "fixture-app",
            name: "Fixture App",
            description: "Fixture app.",
            installUrl: "https://example.com/install",
            category: "testing",
          }],
          appTemplates: [],
          mcpServers: ["fixture-mcp"],
          scheduledTasks: null,
        },
      });
      break;

    case "plugin/install":
      respond(id, {
        authPolicy: "ON_INSTALL",
        appsNeedingAuth: [],
      });
      break;

    case "plugin/uninstall":
      respond(id, {});
      break;

    case "config/value/write":
      respond(id, {
        status: "ok",
        version: "1",
        filePath: "/tmp/mains-test-codex-home/config.toml",
        overriddenMetadata: null,
      });
      break;

    default:
      respond(id, {});
      break;
  }
});
