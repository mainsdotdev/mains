import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkRunRequest } from "../../../../shared/adapter.types";

// Each test spawns the fake codex app-server as a real Node subprocess and
// completes a JSON-RPC handshake. Under full-suite load that spawn can blow
// the default 5s runner timeout even though driver-level timeout behavior
// (e.g. the 40ms turn timeout) is asserted inside the tests themselves — in
// isolation the file passes comfortably. Kill-switch, not a performance target.
vi.setConfig({ testTimeout: 30_000 });

const approvalHarness = vi.hoisted(() => ({
  requests: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../runs/user-input-broker", () => ({
  cancelPendingRequest: vi.fn(),
  cancelPendingRequests: vi.fn(),
  requestToolApproval: vi.fn(async (request: Record<string, unknown>) => {
    approvalHarness.requests.push(request);
    return {
      requestId: request.requestId,
      approved: true,
      answer: "Yes",
    };
  }),
}));

import {
  CODEX_APP_SERVER_PROTOCOL_VERSION,
  createCodexDriver,
} from "./codex.driver";

const fixtureBinary = path.resolve(
  __dirname,
  "../../../../test/fixtures/fake-codex-app-server.mjs",
);

/** One minor above the tested schema — the "forward-compatible" branch. */
const NEWER_THAN_TESTED = CODEX_APP_SERVER_PROTOCOL_VERSION.replace(
  /^(\d+)\.(\d+)\./,
  (_match, major, minor) => `${major}.${Number(minor) + 1}.`,
);

const drivers: Array<ReturnType<typeof createCodexDriver>> = [];
const tempDirs: string[] = [];

function request(runId: string): WorkRunRequest {
  return {
    runId,
    accountId: "account-1",
    execution: {
      workspaceId: "workspace-1",
      cwd: process.cwd(),
    },
    goal: "Return structured output",
  };
}

function readProtocolLog(logPath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitForProtocolMessage(
  logPath: string,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 500,
): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = readProtocolLog(logPath).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readProtocolLog(logPath).find(predicate);
}

/**
 * Wait for a driver event, failing loudly on timeout.
 *
 * Notifications only reach the protocol log when the *client* sends them, so
 * server-driven state (a subagent's turn starting, say) can only be observed
 * through the emitted events. Polling with a silent deadline turns a missed
 * signal into a confusing assertion diff further down, so this throws instead.
 */
async function waitForDriverEvent(
  events: Array<Record<string, unknown>>,
  predicate: (event: Record<string, unknown>) => boolean,
  label: string,
  timeoutMs = 2000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = events.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label}. Saw: ${
      events.map((event) => `${event.type}/${event.phase ?? ""}`).join(", ") ||
      "(no events)"
    }`,
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  approvalHarness.requests.length = 0;
  delete process.env.MAINS_CODEX_FIXTURE_LOG;
  delete process.env.MAINS_CODEX_FIXTURE_VERSION;
  delete process.env.MAINS_CODEX_FIXTURE_LEGACY_INITIALIZE;
  delete process.env.MAINS_CODEX_FIXTURE_PLUGINS_ENABLED;
  delete process.env.MAINS_CODEX_FIXTURE_ACCOUNT;
  delete process.env.MAINS_CODEX_FIXTURE_EMPTY_MODELS;
  await Promise.all(drivers.splice(0).map((driver) => driver.shutdown?.()));
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("codex.driver / app-server protocol", () => {
  // First test in the file pays the cold start (fixture process spawn + first
  // handshake), which can exceed the default 5s when the full suite saturates
  // the CPU — it passes alone. Explicit timeout like the app-server exit test.
  it("identifies the real Mains version during initialization", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    await driver.createSession(request("run-client-version"));

    const initialize = readProtocolLog(logPath).find(
      (message) => message.method === "initialize",
    );
    expect(initialize?.params).toMatchObject({
      clientInfo: {
        name: "mains",
        title: "Mains Desktop",
        version: "0.4.2",
      },
    });
  }, 15_000);

  it("sends Codex thread archive, unarchive, and delete lifecycle requests", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    await driver.createSession(request("run-archive"));
    await driver.archiveSession?.("run-archive");
    await driver.createSession(request("run-unarchive"));
    await driver.unarchiveSession?.("run-unarchive");
    await driver.createSession(request("run-delete"));
    await driver.deleteSession?.("run-delete");

    const messages = readProtocolLog(logPath);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "thread/archive",
          params: { threadId: "thread-1" },
        }),
        expect.objectContaining({
          method: "thread/unarchive",
          params: { threadId: "thread-2" },
        }),
        expect.objectContaining({
          method: "thread/delete",
          params: { threadId: "thread-3" },
        }),
      ]),
    );
  });

  it("rejects Codex CLI versions older than the supported protocol", async () => {
    process.env.MAINS_CODEX_FIXTURE_VERSION = "0.145.0";

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    await expect(
      driver.createSession(request("run-old-codex")),
    ).rejects.toThrow(
      "Codex CLI 0.145.0 is not supported. Mains requires 0.147.0 or newer.",
    );
  });

  it("reports an unsupported Codex CLI in account health metadata", async () => {
    process.env.MAINS_CODEX_FIXTURE_VERSION = "0.145.0";

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    const accountInfo = await driver.getAccountInfo?.();

    expect(accountInfo?.cli).toMatchObject({
      version: "0.145.0",
      outdated: true,
      compatibility: "unsupported",
      minimumVersion: "0.147.0",
      testedProtocolVersion: CODEX_APP_SERVER_PROTOCOL_VERSION,
    });
  });

  it("allows a newer CLI in forward-compatible mode and reports a warning", async () => {
    process.env.MAINS_CODEX_FIXTURE_VERSION = NEWER_THAN_TESTED;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    const accountInfo = await driver.getAccountInfo?.();

    expect(accountInfo?.cli).toMatchObject({
      version: NEWER_THAN_TESTED,
      outdated: false,
      compatibility: "newer",
      testedProtocolVersion: CODEX_APP_SERVER_PROTOCOL_VERSION,
    });
    expect(warn).toHaveBeenCalledWith(
      "[CodexDriver]",
      expect.stringContaining(
        `newer than Mains' tested app-server schema ${CODEX_APP_SERVER_PROTOCOL_VERSION}`,
      ),
    );
    warn.mockRestore();
  });

  it("maps current account variants and complete rate-limit responses", async () => {
    process.env.MAINS_CODEX_FIXTURE_ACCOUNT = "bedrock";
    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    const accountInfo = await driver.getAccountInfo?.();
    const rateLimits = await driver.getRateLimits?.();

    expect(accountInfo?.account).toEqual({
      type: "amazonBedrock",
      usesCodexManagedCredentials: true,
    });
    expect(rateLimits).toMatchObject({
      limitId: "codex",
      primary: { usedPercent: 10 },
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          primary: { usedPercent: 10 },
        },
      },
      rateLimitResetCredits: {
        availableCount: 1,
      },
    });
  });

  it("rejects an app-server that does not expose the current initialize contract", async () => {
    process.env.MAINS_CODEX_FIXTURE_LEGACY_INITIALIZE = "1";

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    await expect(
      driver.createSession(request("run-legacy-initialize")),
    ).rejects.toThrow(
      `Codex app-server initialize response is incompatible with protocol ${CODEX_APP_SERVER_PROTOCOL_VERSION}`,
    );
  });

  it("scopes skill discovery to the requested workspace", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    await driver.listSkills?.(tempDir);

    const skillsList = readProtocolLog(logPath).find(
      (message) => message.method === "skills/list",
    );
    expect(skillsList?.params).toEqual({
      cwds: [tempDir],
      forceReload: true,
    });
  });

  it("does not call plugin RPCs when the Codex plugins feature is disabled", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;
    process.env.MAINS_CODEX_FIXTURE_PLUGINS_ENABLED = "0";

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    const result = await driver.listPlugins?.();

    expect(result).toMatchObject({
      marketplaces: [],
      remoteSyncError: "Codex plugins feature is disabled or unavailable.",
    });
    expect(readProtocolLog(logPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "experimentalFeature/list" }),
      ]),
    );
    expect(readProtocolLog(logPath)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "plugin/list" }),
      ]),
    );
  });

  it("forwards the selected structured-output schema as outputSchema", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    };
    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
      structuredOutputs: {
        result: {
          id: "result",
          name: "Result",
          schema,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      structuredOutputsSelectedId: "result",
    });
    drivers.push(driver);

    const acquired = await driver.createSession(request("run-output-schema"));
    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    expect(outcome.status).toBe("succeeded");
    const turnStart = readProtocolLog(logPath).find(
      (message) => message.method === "turn/start",
    );
    expect(turnStart?.params).toMatchObject({ outputSchema: schema });
    expect(turnStart?.params).not.toHaveProperty("output_schema");
  });

  it("reports usage from thread/tokenUsage/updated", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    process.env.MAINS_CODEX_FIXTURE_LOG = path.join(tempDir, "protocol.jsonl");

    const driver = createCodexDriver({
      binary: fixtureBinary,
      defaultModel: "gpt-5.4",
      timeout: 2000,
    });
    drivers.push(driver);

    const acquired = await driver.createSession(request("run-token-usage"));
    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    expect(outcome).toMatchObject({
      status: "succeeded",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        numTurns: 1,
        model: "gpt-5.4",
      },
    });
  });

  it("maps the current request_user_input question shape", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 2000,
    });
    drivers.push(driver);

    const userInputRequest = request("run-user-input");
    userInputRequest.goal = "ask user";
    const acquired = await driver.createSession(userInputRequest);
    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    expect(outcome.status).toBe("succeeded");
    expect(approvalHarness.requests).toContainEqual(
      expect.objectContaining({
        runId: "run-user-input",
        kind: "ask_user",
        header: "Confirm",
        question: "Proceed with the plan?",
        isOther: true,
        isSecret: true,
        autoResolutionMs: 60_000,
        options: [{
          label: "Yes",
          description: "Continue the plan.",
        }],
      }),
    );
    const response = await waitForProtocolMessage(
      logPath,
      (message) => message.id === 900 && !("method" in message),
    );
    expect(response).toMatchObject({
      result: {
        answers: {
          confirm: { answers: ["Yes"] },
        },
      },
    });
  });

  it("follows the reviewThreadId returned for a detached review", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      defaultModel: "gpt-5.4",
      timeout: 500,
    });
    drivers.push(driver);

    const acquired = await driver.reviewSession?.({
      runId: "run-detached-review",
      accountId: "account-1",
      execution: {
        workspaceId: "workspace-1",
        cwd: process.cwd(),
      },
      target: { type: "uncommittedChanges" },
      delivery: "detached",
      model: "gpt-5.4",
    });
    expect(acquired).toBeDefined();

    const events: unknown[] = [];
    const outcome = await driver.executePrompt(
      acquired!.session,
      acquired!.prompt,
      async (event) => {
        events.push(event);
      },
      new AbortController().signal,
    );

    expect(outcome.status).toBe("succeeded");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        content: "Review complete.",
      }),
    );
    await driver.cleanup?.(acquired!.session);
    const reviewStart = readProtocolLog(logPath).find(
      (message) => message.method === "review/start",
    );
    expect(reviewStart?.params).not.toHaveProperty("model");
    const unsubscribedThreadIds = readProtocolLog(logPath)
      .filter((message) => message.method === "thread/unsubscribe")
      .map((message) => (
        message.params as { threadId?: string } | undefined
      )?.threadId);
    expect(unsubscribedThreadIds).toEqual([
      "thread-1",
      "thread-1-review",
    ]);
  });

  it("lets the run's mode-resolved snapshot set the thread personality", async () => {
    // Work/Chat pin `personality` through the mode harness; the provider
    // setting is what Code spaces keep. The run snapshot has to win, the same
    // way it already does for the sandbox.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
      personality: "pragmatic",
      sandboxMode: "workspace-write",
    });
    drivers.push(driver);

    const acquired = await driver.createSession({
      ...request("run-personality"),
      mode: "chat",
      configSnapshot: {
        personality: "friendly",
        sandboxMode: "read-only",
      },
    });

    const threadStart = readProtocolLog(logPath).find(
      (message) => message.method === "thread/start",
    );
    expect(threadStart?.params).toMatchObject({
      personality: "friendly",
      sandbox: "read-only",
    });
    await driver.cleanup?.(acquired.session);
  });

  it("keeps the provider personality when the run pins none", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
      personality: "pragmatic",
    });
    drivers.push(driver);

    const acquired = await driver.createSession(request("run-personality-default"));

    const threadStart = readProtocolLog(logPath).find(
      (message) => message.method === "thread/start",
    );
    expect(threadStart?.params).toMatchObject({ personality: "pragmatic" });
    await driver.cleanup?.(acquired.session);
  });

  it("lets the run snapshot turn plan mode off on a new thread", async () => {
    // The provider row is shared by every space on this provider; a Code
    // space leaving `planMode` on must not plan a Work/Chat run, and the
    // harness says so through the snapshot.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
      planMode: true,
      goalMode: true,
    });
    drivers.push(driver);

    const acquired = await driver.createSession({
      ...request("run-plan-pinned-off"),
      mode: "work",
      configSnapshot: { planMode: false, goalMode: false },
    });
    await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    const log = readProtocolLog(logPath);
    const turnStart = log.find((message) => message.method === "turn/start");
    expect(turnStart).toBeDefined();
    expect(
      (turnStart?.params as { collaborationMode?: unknown }).collaborationMode,
    ).toBeUndefined();
    expect(log.some((message) => message.method === "thread/goal/set")).toBe(false);
  });

  it("keeps the provider's plan and goal when the run pins neither", async () => {
    // Control for the test above: a developer run carries no snapshot and
    // the provider row decides.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
      planMode: true,
      goalMode: true,
    });
    drivers.push(driver);

    const acquired = await driver.createSession(request("run-plan-provider"));
    await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    const log = readProtocolLog(logPath);
    const turnStart = log.find((message) => message.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      collaborationMode: { mode: "plan" },
    });
    expect(log.some((message) => message.method === "thread/goal/set")).toBe(true);
  });

  it("uses the app-server response model to pin create, resume, and fork modes when the catalog is empty", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;
    process.env.MAINS_CODEX_FIXTURE_EMPTY_MODELS = "1";

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
      planMode: true,
    });
    drivers.push(driver);

    const created = await driver.createSession(
      request("run-response-model-source"),
    );
    await driver.executePrompt(
      created.session,
      created.prompt,
      async () => undefined,
      new AbortController().signal,
    );
    expect(
      readProtocolLog(logPath)
        .filter((message) => message.method === "turn/start")
        .at(-1)?.params,
    ).toMatchObject({
      model: "gpt-fixture-codex",
      collaborationMode: {
        mode: "plan",
        settings: { model: "gpt-fixture-codex" },
      },
    });

    const resumed = await driver.resumeSession?.({
      runId: "run-response-model-source",
      accountId: "account-1",
      execution: { workspaceId: "workspace-1", cwd: process.cwd() },
      message: "Resume outside plan mode",
      mode: "work",
      configSnapshot: { planMode: false },
    });
    expect(resumed).toBeDefined();
    await driver.executePrompt(
      resumed!.session,
      resumed!.prompt,
      async () => undefined,
      new AbortController().signal,
    );
    expect(
      readProtocolLog(logPath)
        .filter((message) => message.method === "turn/start")
        .at(-1)?.params,
    ).toMatchObject({
      model: "gpt-fixture-codex",
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-fixture-codex" },
      },
    });

    const forked = await driver.forkSession?.({
      runId: "run-response-model-fork",
      sourceRunId: "run-response-model-source",
      accountId: "account-1",
      execution: { workspaceId: "workspace-1", cwd: process.cwd() },
      message: "Fork outside plan mode",
      mode: "work",
      configSnapshot: { planMode: false },
    });
    expect(forked).toBeDefined();
    await driver.executePrompt(
      forked!.session,
      forked!.prompt,
      async () => undefined,
      new AbortController().signal,
    );
    expect(
      readProtocolLog(logPath)
        .filter((message) => message.method === "turn/start")
        .at(-1)?.params,
    ).toMatchObject({
      model: "gpt-fixture-codex",
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-fixture-codex" },
      },
    });
  });

  it("keeps a resumed run out of plan mode when its snapshot says so", async () => {
    // Resume used to read `config.planMode` straight off the provider row,
    // so the pin only held for the first turn of a Work/Chat run.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
      planMode: true,
      goalMode: true,
    });
    drivers.push(driver);
    await driver.createSession({
      ...request("run-resume-plan-pinned"),
      mode: "work",
      configSnapshot: { planMode: false, goalMode: false },
    });

    const acquired = await driver.resumeSession?.({
      runId: "run-resume-plan-pinned",
      accountId: "account-1",
      execution: { workspaceId: "workspace-1", cwd: process.cwd() },
      message: "Keep going",
      mode: "work",
      configSnapshot: { planMode: false, goalMode: false },
    });
    expect(acquired).toBeDefined();
    await driver.executePrompt(
      acquired!.session,
      acquired!.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    const log = readProtocolLog(logPath);
    const resumeRequest = log.find(
      (message) => message.method === "thread/resume",
    );
    expect(resumeRequest?.params).toMatchObject({
      threadId: "thread-1",
      excludeTurns: true,
    });
    const turnStart = log.find((message) => message.method === "turn/start");
    // forceReset on continue: an explicit "default", never "plan".
    expect(turnStart?.params).toMatchObject({
      collaborationMode: { mode: "default" },
    });
    expect(log.some((message) => message.method === "thread/goal/set")).toBe(false);
  });

  it("keeps a forked run out of plan mode when its snapshot says so", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
      planMode: true,
      goalMode: true,
    });
    drivers.push(driver);
    await driver.createSession({
      ...request("run-fork-plan-source"),
      mode: "work",
      configSnapshot: { planMode: false, goalMode: false },
    });

    const acquired = await driver.forkSession?.({
      runId: "run-fork-plan-target",
      sourceRunId: "run-fork-plan-source",
      accountId: "account-1",
      execution: { workspaceId: "workspace-1", cwd: process.cwd() },
      message: "Branch off here",
      mode: "work",
      configSnapshot: { planMode: false, goalMode: false },
    });
    expect(acquired).toBeDefined();
    await driver.executePrompt(
      acquired!.session,
      acquired!.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    const log = readProtocolLog(logPath);
    const turnStart = log.find(
      (message) =>
        message.method === "turn/start" &&
        (message.params as { threadId?: string } | undefined)?.threadId ===
          "thread-1-fork",
    );
    expect(turnStart?.params).toMatchObject({
      collaborationMode: { mode: "default" },
    });
    expect(log.some((message) => message.method === "thread/goal/set")).toBe(false);
  });

  it("uses the generated thread/fork contract without obsolete fields", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
      personality: "friendly",
    });
    drivers.push(driver);

    await driver.createSession(request("run-fork-source"));
    const acquired = await driver.forkSession?.({
      runId: "run-fork-target",
      sourceRunId: "run-fork-source",
      accountId: "account-1",
      execution: {
        workspaceId: "workspace-1",
        cwd: process.cwd(),
      },
      message: "continue from the fork",
      model: "gpt-5.4",
    });
    expect(acquired).toBeDefined();

    const outcome = await driver.executePrompt(
      acquired!.session,
      acquired!.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    expect(outcome.status).toBe("succeeded");
    const forkRequest = readProtocolLog(logPath).find(
      (message) => message.method === "thread/fork",
    );
    expect(forkRequest?.params).toMatchObject({
      threadId: "thread-1",
      model: "gpt-5.4",
      excludeTurns: true,
    });
    expect(forkRequest?.params).not.toHaveProperty("personality");

    const turnStart = readProtocolLog(logPath).find(
      (message) =>
        message.method === "turn/start" &&
        (message.params as { threadId?: string } | undefined)?.threadId ===
          "thread-1-fork",
    );
    expect(turnStart?.params).toMatchObject({
      input: [
        expect.objectContaining({
          type: "text",
          text_elements: [],
        }),
      ],
    });
  });

  it("preserves general context when continuing a session", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-driver-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);
    await driver.createSession(request("run-continue-context"));

    const acquired = await driver.resumeSession?.({
      runId: "run-continue-context",
      accountId: "account-1",
      execution: {
        workspaceId: "workspace-1",
        cwd: process.cwd(),
      },
      message: "Continue with this evidence",
      context: [{
        kind: "file",
        ref: "src/auth.ts",
        content: "export const authEnabled = true;",
      }],
    });
    expect(acquired).toBeDefined();
    await driver.executePrompt(
      acquired!.session,
      acquired!.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    const turnStart = readProtocolLog(logPath).find(
      (message) => message.method === "turn/start",
    );
    const input = (
      turnStart?.params as {
        input?: Array<{ type?: string; text?: string }>;
      } | undefined
    )?.input;
    expect(input?.[0]?.text).toContain(
      "[file: src/auth.ts]\nexport const authEnabled = true;",
    );
    expect(input?.[0]?.text).toContain(
      "Continue with this evidence",
    );
  });

  it("preserves general context when forking a session", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-driver-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);
    await driver.createSession(request("run-fork-context-source"));

    const acquired = await driver.forkSession?.({
      runId: "run-fork-context-target",
      sourceRunId: "run-fork-context-source",
      accountId: "account-1",
      execution: {
        workspaceId: "workspace-1",
        cwd: process.cwd(),
      },
      message: "Fork with this evidence",
      context: [{
        kind: "diff",
        ref: "HEAD~1",
        content: "+ const enabled = true;",
      }],
    });
    expect(acquired).toBeDefined();
    await driver.executePrompt(
      acquired!.session,
      acquired!.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    const turnStart = readProtocolLog(logPath).find(
      (message) =>
        message.method === "turn/start" &&
        (
          message.params as { threadId?: string } | undefined
        )?.threadId === "thread-1-fork",
    );
    const input = (
      turnStart?.params as {
        input?: Array<{ type?: string; text?: string }>;
      } | undefined
    )?.input;
    expect(input?.[0]?.text).toContain(
      "[diff: HEAD~1]\n+ const enabled = true;",
    );
    expect(input?.[0]?.text).toContain(
      "Fork with this evidence",
    );
  });

  it("routes concurrent run events by thread without handler interference", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    process.env.MAINS_CODEX_FIXTURE_LOG = path.join(tempDir, "protocol.jsonl");

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);

    const requestA = request("run-parallel-a");
    requestA.goal = "parallel plan slow A";
    const requestB = request("run-parallel-b");
    requestB.goal = "parallel plan fast B";
    const [acquiredA, acquiredB] = await Promise.all([
      driver.createSession(requestA),
      driver.createSession(requestB),
    ]);
    const eventsA: unknown[] = [];
    const eventsB: unknown[] = [];

    const [outcomeA, outcomeB] = await Promise.all([
      driver.executePrompt(
        acquiredA.session,
        acquiredA.prompt,
        async (event) => {
          eventsA.push(event);
        },
        new AbortController().signal,
      ),
      driver.executePrompt(
        acquiredB.session,
        acquiredB.prompt,
        async (event) => {
          eventsB.push(event);
        },
        new AbortController().signal,
      ),
    ]);

    expect(outcomeA.status).toBe("succeeded");
    expect(outcomeB.status).toBe("succeeded");
    expect(eventsA.some((event) => (
      event as { content?: string }
    ).content === "parallel plan slow A")).toBe(true);
    expect(eventsA.some((event) => (
      event as { content?: string }
    ).content === "parallel plan fast B")).toBe(false);
    expect(eventsB.some((event) => (
      event as { content?: string }
    ).content === "parallel plan fast B")).toBe(true);
    expect(eventsB.some((event) => (
      event as { content?: string }
    ).content === "parallel plan slow A")).toBe(false);
    expect(eventsA).toContainEqual({
      type: "plan_update",
      providerTurnId: "turn-thread-1",
      explanation: "Working on parallel plan slow A",
      steps: [{
        step: "parallel plan slow A",
        status: "in_progress",
      }],
    });
    expect(eventsA).not.toContainEqual(
      expect.objectContaining({
        type: "plan_update",
        providerTurnId: "turn-thread-2",
      }),
    );
    expect(eventsB).toContainEqual({
      type: "plan_update",
      providerTurnId: "turn-thread-2",
      explanation: "Working on parallel plan fast B",
      steps: [{
        step: "parallel plan fast B",
        status: "in_progress",
      }],
    });
    expect(eventsB).not.toContainEqual(
      expect.objectContaining({
        type: "plan_update",
        providerTurnId: "turn-thread-1",
      }),
    );
  });

  it("waits for the parent turn after a subagent turn completes", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-driver-"),
    );
    tempDirs.push(tempDir);
    process.env.MAINS_CODEX_FIXTURE_LOG = path.join(
      tempDir,
      "protocol.jsonl",
    );

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);
    const subagentRequest = request("run-subagent-completion");
    subagentRequest.goal = "subagent completion";
    const acquired = await driver.createSession(subagentRequest);
    let settled = false;
    const outcomePromise = driver
      .executePrompt(
        acquired.session,
        acquired.prompt,
        async () => undefined,
        new AbortController().signal,
      )
      .finally(() => {
        settled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(settled).toBe(false);
    await expect(outcomePromise).resolves.toMatchObject({
      status: "succeeded",
    });
  });

  it("finalizes duplicate parent completion notifications once", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-driver-"),
    );
    tempDirs.push(tempDir);
    process.env.MAINS_CODEX_FIXTURE_LOG = path.join(
      tempDir,
      "protocol.jsonl",
    );

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);
    const duplicateRequest = request("run-duplicate-completion");
    duplicateRequest.goal = "duplicate completion";
    const acquired = await driver.createSession(duplicateRequest);
    const events: Array<Record<string, unknown>> = [];

    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async (event) => {
        events.push(event as unknown as Record<string, unknown>);
      },
      new AbortController().signal,
    );

    expect(outcome.status).toBe("succeeded");
    expect(
      events.filter(
        (event) =>
          event.content === "Final answer" &&
          event.ephemeral !== true,
      ),
    ).toHaveLength(1);
  });

  it("keeps a replacement driver session alive when the previous driver shuts down", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-driver-"),
    );
    tempDirs.push(tempDir);
    process.env.MAINS_CODEX_FIXTURE_LOG = path.join(
      tempDir,
      "protocol.jsonl",
    );

    const previousDriver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    const replacementDriver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(previousDriver, replacementDriver);

    await previousDriver.createSession(
      request("run-previous-driver"),
    );
    await replacementDriver.createSession(
      request("run-replacement-driver"),
    );

    await previousDriver.shutdown?.();

    await expect(
      replacementDriver.canResumeSession?.(
        "run-replacement-driver",
      ),
    ).resolves.toBe(true);
  });

  it("does not start a turn when execution is already aborted", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-driver-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);

    const acquired = await driver.createSession(
      request("run-already-aborted"),
    );
    const abortController = new AbortController();
    abortController.abort();

    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      abortController.signal,
    );

    expect(outcome.status).toBe("canceled");
    expect(
      readProtocolLog(logPath).filter(
        (message) => message.method === "turn/start",
      ),
    ).toHaveLength(0);
  });

  it("interrupts the Codex turn when execution times out", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-driver-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 40,
    });
    drivers.push(driver);
    const timeoutRequest = request("run-timeout-interrupt");
    timeoutRequest.goal = "timeout turn";
    const acquired = await driver.createSession(timeoutRequest);

    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    expect(outcome).toMatchObject({
      status: "failed",
      summary: "Codex run timed out after 40ms",
    });
    expect(
      readProtocolLog(logPath).find(
        (message) => message.method === "turn/interrupt",
      )?.params,
    ).toEqual({
      threadId: "thread-1",
      turnId: "turn-thread-1",
    });
  });

  it("finalizes an aborted active turn without waiting for timeout", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-driver-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);
    const abortRequest = request("run-active-abort");
    abortRequest.goal = "timeout turn";
    const acquired = await driver.createSession(abortRequest);
    const abortController = new AbortController();
    const startedAt = Date.now();
    const outcomePromise = driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      abortController.signal,
    );

    await waitForProtocolMessage(
      logPath,
      (message) => message.method === "turn/start",
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    abortController.abort();
    const outcome = await outcomePromise;

    expect(outcome.status).toBe("canceled");
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(
      readProtocolLog(logPath).some(
        (message) => message.method === "turn/interrupt",
      ),
    ).toBe(true);
  });

  it("interrupts active subagents and gives Luna an explicit resume path on continue", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-driver-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);
    const runId = "run-subagent-abort-continue";
    const abortRequest = request(runId);
    abortRequest.goal = "active subagent timeout turn";
    const acquired = await driver.createSession(abortRequest);
    const firstEvents: Array<Record<string, unknown>> = [];
    const abortController = new AbortController();
    const outcomePromise = driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async (event) => {
        firstEvents.push(event as unknown as Record<string, unknown>);
      },
      abortController.signal,
    );

    await waitForProtocolMessage(
      logPath,
      (message) => message.method === "turn/start",
    );
    // Wait for "running", not "invoked". The spawn item that produces
    // "invoked" arrives one notification *before* the child's turn/started,
    // and it is that turn/started which records the child's activeTurnId —
    // the field interruptRunTurns needs to target it. Aborting on "invoked"
    // races the two, and loses whenever the notifications land in separate
    // stdin chunks.
    await waitForDriverEvent(
      firstEvents,
      (event) =>
        event.type === "subagent" &&
        event.phase === "running" &&
        event.agentId === "thread-1-child",
      "the child subagent's turn to start",
    );

    abortController.abort();
    await expect(outcomePromise).resolves.toMatchObject({ status: "canceled" });

    // The outcome resolving does NOT mean both interrupts are on disk. The
    // fixture answers the parent's turn/interrupt by emitting the parent's
    // turn/completed, which finalizes the run — it can do that before it has
    // even read the child's interrupt off stdin, and the log is written by
    // that separate process. Reading once here saw only the parent on ubuntu
    // CI while the child's line landed microseconds later. Wait for it.
    await waitForProtocolMessage(
      logPath,
      (message) =>
        message.method === "turn/interrupt" &&
        (message.params as { threadId?: string } | undefined)?.threadId ===
          "thread-1-child",
      2000,
    );

    const interruptedTurns = readProtocolLog(logPath)
      .filter((message) => message.method === "turn/interrupt")
      .map((message) => message.params);
    expect(interruptedTurns).toEqual(
      expect.arrayContaining([
        {
          threadId: "thread-1",
          turnId: "turn-thread-1",
        },
        {
          threadId: "thread-1-child",
          turnId: "turn-thread-1-child",
        },
      ]),
    );

    await driver.cleanup?.(acquired.session);
    const continued = await driver.resumeSession?.({
      runId,
      accountId: "account-1",
      execution: {
        workspaceId: "workspace-1",
        cwd: process.cwd(),
      },
      message: "continue interrupted subagent",
    });
    expect(continued).toBeDefined();

    const continuedEvents: Array<Record<string, unknown>> = [];
    const continuedOutcome = await driver.executePrompt(
      continued!.session,
      continued!.prompt,
      async (event) => {
        continuedEvents.push(event as unknown as Record<string, unknown>);
      },
      new AbortController().signal,
    );

    const continuedTurnStart = readProtocolLog(logPath)
      .filter((message) => message.method === "turn/start")
      .at(-1);
    const continuedInput = (
      continuedTurnStart?.params as
        | { input?: Array<{ type?: string; text?: string }> }
        | undefined
    )?.input;
    const continuedPrompt = continuedInput?.find(
      (item) => item.type === "text",
    )?.text;
    expect(continuedPrompt).toContain("<mains_interrupted_subagents>");
    expect(continuedPrompt).toContain("thread-1-child");
    expect(continuedPrompt).toContain("resume_agent");
    expect(continuedPrompt).toContain("send_input");

    expect(continuedOutcome.status).toBe("succeeded");
    expect(continuedEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolName: "resumeCollabAgent",
      }),
    );
    expect(continuedEvents).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "running",
        agentId: "thread-1-child",
        parentToolUseId: "spawn-thread-1-child",
      }),
    );
    expect(continuedEvents).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "completed",
        agentId: "thread-1-child",
        parentToolUseId: "spawn-thread-1-child",
        result: "Continued child result",
      }),
    );
    expect(
      readProtocolLog(logPath).filter(
        (message) => message.method === "thread/resume",
      ).at(-1)?.params,
    ).toMatchObject({ threadId: "thread-1" });
    expect(
      readProtocolLog(logPath).some(
        (message) =>
          message.method === "thread/delete" ||
          message.method === "thread/archive",
      ),
    ).toBe(false);
  });

  it(
    "fails pending RPCs immediately when app-server exits",
    async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
      tempDirs.push(tempDir);
      process.env.MAINS_CODEX_FIXTURE_LOG = path.join(tempDir, "protocol.jsonl");

      const driver = createCodexDriver({
        binary: fixtureBinary,
        timeout: 500,
      });
      drivers.push(driver);

      const crashRequest = request("run-crash");
      crashRequest.goal = "crash before response";
      const acquired = await driver.createSession(crashRequest);
      const startedAt = Date.now();
      const outcome = await driver.executePrompt(
        acquired.session,
        acquired.prompt,
        async () => undefined,
        new AbortController().signal,
      );

      expect(outcome.status).toBe("failed");
      expect(outcome.summary).toMatch(/app-server.*(?:exit|close)/i);
      expect(Date.now() - startedAt).toBeLessThan(1000);
    },
    35_000,
  );

  it("surfaces managed-network context in command approvals", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    process.env.MAINS_CODEX_FIXTURE_LOG = path.join(tempDir, "protocol.jsonl");

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);

    const networkRequest = request("run-network-approval");
    networkRequest.goal = "network approval";
    const acquired = await driver.createSession(networkRequest);
    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );

    expect(outcome.status).toBe("succeeded");
    expect(approvalHarness.requests).toContainEqual(
      expect.objectContaining({
        runId: "run-network-approval",
        toolName: "Bash",
        toolInput: expect.objectContaining({
          command: "Network access: https://api.example.com",
          networkApprovalContext: {
            host: "api.example.com",
            protocol: "https",
          },
          proposedNetworkPolicyAmendments: [{
            host: "api.example.com",
            action: "allow",
          }],
        }),
      }),
    );
  });

  it("declines a late permission request with the permission response shape", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);

    const lateRequest = request("run-late-permission");
    lateRequest.goal = "late permission";
    const acquired = await driver.createSession(lateRequest);
    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );
    expect(outcome.status).toBe("succeeded");

    const response = await waitForProtocolMessage(
      logPath,
      (message) => message.id === 901 && !("method" in message),
    );
    expect(response).toMatchObject({
      result: {
        permissions: {},
        scope: "turn",
      },
    });
    expect(response?.result).not.toHaveProperty("decision");
  });

  it("safely declines MCP forms whose required values cannot be collected", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);

    const mcpRequest = request("run-mcp-form");
    mcpRequest.goal = "mcp required form";
    const acquired = await driver.createSession(mcpRequest);
    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );
    expect(outcome.status).toBe("succeeded");

    const response = await waitForProtocolMessage(
      logPath,
      (message) => message.id === 903 && !("method" in message),
    );
    expect(response).toMatchObject({
      result: {
        action: "decline",
        content: null,
        _meta: null,
      },
    });
  });

  it("answers currentTime/read with epoch seconds", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-driver-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    process.env.MAINS_CODEX_FIXTURE_LOG = logPath;

    const driver = createCodexDriver({
      binary: fixtureBinary,
      timeout: 500,
    });
    drivers.push(driver);

    const timeRequest = request("run-current-time");
    timeRequest.goal = "current time";
    const acquired = await driver.createSession(timeRequest);
    const outcome = await driver.executePrompt(
      acquired.session,
      acquired.prompt,
      async () => undefined,
      new AbortController().signal,
    );
    expect(outcome.status).toBe("succeeded");

    const response = await waitForProtocolMessage(
      logPath,
      (message) => message.id === 904 && !("method" in message),
    );
    expect(response?.result).toEqual({
      currentTimeAt: expect.any(Number),
    });
  });
});
