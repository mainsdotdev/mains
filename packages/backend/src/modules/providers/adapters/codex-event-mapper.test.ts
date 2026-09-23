import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkRunEvent } from "../../../../shared/adapter.types";
import {
  createCodexEventMapper,
  SUB_THREAD_TOOL_ITEM_TYPES,
  type CodexEventRunState,
} from "./codex-event-mapper";

const tempDirs: string[] = [];

function createRunState(
  rootPath: string | null = null,
): CodexEventRunState {
  return {
    threadId: "thread-parent",
    turnId: null,
    currentMessageItemId: null,
    agentMessageBuffer: "",
    emittedAgentMessageItemIds: new Set(),
    emittedAsyncQuestionItemIds: new Set(),
    pendingFlush: [],
    mainsCtx: {
      workspaceId: "workspace-1",
      rootPath,
      runId: "run-1",
    },
    fileChangeBuffers: new Map(),
    fileChangeItems: new Map(),
    commandOutputBuffers: new Map(),
    emittedImagePaths: new Set(),
    emittedDocPaths: new Set(),
    emittedVisualizationKeys: new Set(),
    runStartedAt: Date.now(),
    planBuffers: new Map(),
    lastPlanSnapshot: null,
    subAgents: new Map(),
  };
}

function createHarness(state = createRunState()) {
  const runs = new Map([["run-1", state]]);
  const onReviewCompleted = vi.fn();
  const onParentThreadStarted = vi.fn();
  const mapper = createCodexEventMapper({
    getRunState: (runId) => runs.get(runId),
    onReviewCompleted,
    onParentThreadStarted,
    getDefaultModel: () => "gpt-fixture-codex",
  });
  return {
    mapper,
    onParentThreadStarted,
    onReviewCompleted,
    state,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Codex event mapper", () => {
  it("preserves MCP App resource context on completed tool calls", () => {
    const { mapper } = createHarness();
    const result = {
      content: [{ type: "text", text: "Found 10 itineraries" }],
      structuredContent: { itineraries: [{ id: "flight-1" }] },
      _meta: {
        ui: {
          resourceUri: "ui://widgets/flights.html",
        },
      },
    };

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "mcp-call-1",
          type: "mcpToolCall",
          server: "codex_apps",
          tool: "skyscanner.flights-live-prices-create-search",
          arguments: { origin_iata: "TYO", destination_iata: "SEL" },
          appContext: {
            connectorId: "skyscanner",
            linkId: null,
            resourceUri: null,
            appName: "Skyscanner",
            actionName: "Flights live prices create search",
          },
          mcpAppResourceUri: null,
          result,
          error: null,
        },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolName:
          "mcp__codex_apps__skyscanner.flights-live-prices-create-search",
        output: result,
        metadata: expect.objectContaining({
          mcpApp: {
            server: "codex_apps",
            tool: "skyscanner.flights-live-prices-create-search",
            resourceUri: "ui://widgets/flights.html",
            originCallId: "mcp-call-1",
            connectorId: "skyscanner",
            appName: "Skyscanner",
            actionName: "Flights live prices create search",
          },
        }),
      }),
    );
  });

  it("owns parent thread registration and agent-message buffering", () => {
    const state = createRunState();
    state.threadId = null;
    const { mapper, onParentThreadStarted } =
      createHarness(state);

    mapper.mapNotification(
      "thread/started",
      {
        thread: {
          id: "thread-new",
          agentNickname: null,
          agentRole: null,
        },
      },
      "run-1",
    );
    const streaming = mapper.mapNotification(
      "item/agentMessage/delta",
      {
        threadId: "thread-new",
        itemId: "message-1",
        delta: "Hello",
      },
      "run-1",
    );
    const completed = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-new",
        item: {
          id: "message-1",
          type: "agentMessage",
        },
      },
      "run-1",
    );

    expect(state.threadId).toBe("thread-new");
    expect(onParentThreadStarted).toHaveBeenCalledWith(
      "run-1",
      "thread-new",
    );
    expect(streaming).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        content: "Hello",
        ephemeral: true,
        streamId: "codex-msg-run-1-message-1",
      }),
    );
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "report",
        content: "Hello",
        metadata: {
          source: "agent_message",
          itemId: "message-1",
        },
      }),
    );
    expect(state.agentMessageBuffer).toBe("");
  });

  it("strips citation annotations from streamed and flushed messages", () => {
    const { mapper } = createHarness();

    // Web-search answers wrap citations in private-use markers whose payload
    // spans deltas — the live preview must not flash the half-received block.
    const partial = mapper.mapNotification(
      "item/agentMessage/delta",
      {
        threadId: "thread-parent",
        itemId: "message-1",
        delta: "Buy once and play on Xbox and PC \uE200cite\uE202turn1",
      },
      "run-1",
    );
    const rest = mapper.mapNotification(
      "item/agentMessage/delta",
      {
        threadId: "thread-parent",
        itemId: "message-1",
        delta: "view0\uE202turn2view3\uE201 Included at launch.",
      },
      "run-1",
    );
    const completed = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: { id: "message-1", type: "agentMessage" },
      },
      "run-1",
    );

    expect(partial).toContainEqual(
      expect.objectContaining({
        content: "Buy once and play on Xbox and PC",
        ephemeral: true,
      }),
    );
    expect(rest).toContainEqual(
      expect.objectContaining({
        content: "Buy once and play on Xbox and PC Included at launch.",
        ephemeral: true,
      }),
    );
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "report",
        content: "Buy once and play on Xbox and PC Included at launch.",
        metadata: { source: "agent_message", itemId: "message-1" },
      }),
    );
  });

  it("turns a completed Codex visualize reference into an HTML artifact", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-viz-mapper-"));
    tempDirs.push(root);
    const visualizationPath = path.join(root, "spinning-gyroscope.html");
    fs.writeFileSync(
      visualizationPath,
      '<div id="gyro"><button type="button">Pause</button></div>',
    );
    const canonicalVisualizationPath = fs.realpathSync.native(visualizationPath);
    const state = createRunState(root);
    state.runStartedAt = Date.now() - 1_000;
    const { mapper } = createHarness(state);
    const reference = `\uE200visualize\uE202${JSON.stringify({
      path: visualizationPath,
      mode: "wide",
      title: "Spinning gyroscope",
    })}\uE201`;

    const streaming = mapper.mapNotification(
      "item/agentMessage/delta",
      {
        threadId: "thread-parent",
        itemId: "message-viz",
        delta: `Interactive model ready.\n\n${reference}`,
      },
      "run-1",
    );
    const completed = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: { id: "message-viz", type: "agentMessage" },
      },
      "run-1",
    );

    expect(streaming).toContainEqual(
      expect.objectContaining({
        content: "Interactive model ready.\n\n",
        ephemeral: true,
      }),
    );
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "report",
        content: "Interactive model ready.",
      }),
    );
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "visualization",
        path: canonicalVisualizationPath,
        metadata: expect.objectContaining({
          kind: "visualization",
          source: "codex_visualize",
          path: canonicalVisualizationPath,
          mode: "wide",
          title: "Spinning gyroscope",
          itemId: "message-viz",
        }),
      }),
    );
  });

  it("accepts a visualize path when the workspace root is a filesystem alias", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mains-viz-alias-"));
    tempDirs.push(parent);
    const realRoot = path.join(parent, "Mains", "runs", "run-1", "work");
    const aliasRoot = path.join(parent, "mains-work");
    fs.mkdirSync(realRoot, { recursive: true });
    fs.symlinkSync(
      realRoot,
      aliasRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
    const visualizationPath = path.join(realRoot, "spinning-gyroscope.html");
    fs.writeFileSync(visualizationPath, "<div>gyroscope</div>");
    const state = createRunState(aliasRoot);
    state.runStartedAt = Date.now() - 1_000;
    const { mapper } = createHarness(state);

    const completed = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "message-viz-alias",
          type: "agentMessage",
          text: `\uE200visualize\uE202${JSON.stringify({
            path: visualizationPath,
            mode: "wide",
          })}\uE201`,
        },
      },
      "run-1",
    );

    expect(completed).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "visualization",
        path: fs.realpathSync.native(visualizationPath),
      }),
    );
  });

  it("does not surface visualize paths outside the workspace allowlist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-viz-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mains-viz-outside-"));
    tempDirs.push(root, outside);
    const visualizationPath = path.join(outside, "outside.html");
    fs.writeFileSync(visualizationPath, "<div>outside</div>");
    const state = createRunState(root);
    state.runStartedAt = Date.now() - 1_000;
    const { mapper } = createHarness(state);

    const completed = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "message-viz",
          type: "agentMessage",
          text: `\uE200visualize\uE202${JSON.stringify({ path: visualizationPath })}\uE201`,
        },
      },
      "run-1",
    );

    expect(completed).not.toContainEqual(
      expect.objectContaining({ kind: "visualization" }),
    );
  });

  it("does not follow a workspace directory symlink to an outside visualization", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-viz-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mains-viz-outside-"));
    tempDirs.push(root, outside);
    const visualizationPath = path.join(outside, "outside.html");
    fs.writeFileSync(visualizationPath, "<div>outside</div>");
    const linkedDirectory = path.join(root, "linked");
    fs.symlinkSync(
      outside,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    const state = createRunState(root);
    state.runStartedAt = Date.now() - 1_000;
    const { mapper } = createHarness(state);

    const completed = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "message-viz-symlink-escape",
          type: "agentMessage",
          text: `\uE200visualize\uE202${JSON.stringify({
            path: path.join(linkedDirectory, "outside.html"),
          })}\uE201`,
        },
      },
      "run-1",
    );

    expect(completed).not.toContainEqual(
      expect.objectContaining({ kind: "visualization" }),
    );
  });

  it("surfaces a completed async agent message and its questions without deltas", () => {
    const { mapper } = createHarness();
    const notification = {
      threadId: "thread-parent",
      item: {
        id: "message-async",
        type: "agentMessage",
        text: "Background review finished.",
        phase: "final_answer",
        delivery: "async",
        questions: [
          {
            title: "Which environment?",
            options: ["Staging", "Production"],
          },
          { title: "Anything else?", options: null },
        ],
      },
    };

    const events = mapper.mapNotification(
      "item/completed",
      notification,
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "report",
        content: "Background review finished.",
        metadata: expect.objectContaining({
          source: "agent_message",
          itemId: "message-async",
          messagePhase: "final_answer",
          delivery: "async",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "report",
        content:
          "**Which environment?**\n- Staging\n- Production\n\n**Anything else?**",
        metadata: {
          source: "codex_async_questions",
          itemId: "message-async",
          delivery: "async",
          questions: notification.item.questions,
        },
      }),
    );

    expect(
      mapper.mapNotification("item/completed", notification, "run-1"),
    ).toEqual([]);
  });

  it("keeps late async questions after a competing message flushed the text", () => {
    const { mapper, state } = createHarness();
    mapper.mapNotification(
      "item/agentMessage/delta",
      {
        threadId: "thread-parent",
        itemId: "message-async",
        delta: "Background review finished.",
      },
      "run-1",
    );
    mapper.mapNotification(
      "item/agentMessage/delta",
      {
        threadId: "thread-parent",
        itemId: "message-next",
        delta: "Next message.",
      },
      "run-1",
    );

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "message-async",
          type: "agentMessage",
          text: "Background review finished.",
          delivery: "async",
          questions: [{ title: "Continue?", options: ["Yes", "No"] }],
        },
      },
      "run-1",
    );

    expect(state.pendingFlush).toContainEqual(
      expect.objectContaining({ content: "Background review finished." }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: "artifact",
        content: "**Continue?**\n- Yes\n- No",
        metadata: expect.objectContaining({ source: "codex_async_questions" }),
      }),
    ]);
  });

  it.each([
    "plain output",
    [
      { type: "input_text", text: "structured output" },
      { type: "input_image", image_url: "data:image/png;base64,AAAA" },
    ],
  ])("does not duplicate a functionCallOutput as a raw log (%j)", (output) => {
    const { mapper } = createHarness();

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "function-output-1",
          type: "functionCallOutput",
          name: "CheckPackage",
          namespace: null,
          output,
        },
      },
      "run-1",
    );

    expect(events).toEqual([]);
  });

  it("deduplicates live usage snapshots for the same turn", () => {
    const { mapper } = createHarness();

    const first = mapper.mapNotification(
      "thread/tokenUsage/updated",
      {
        threadId: "thread-parent",
        turnId: "turn-1",
        tokenUsage: {
          last: {
            totalTokens: 10,
            inputTokens: 8,
            outputTokens: 2,
          },
          modelContextWindow: 100,
        },
      },
      "run-1",
      "gpt-fixture-codex",
    );
    const second = mapper.mapNotification(
      "thread/tokenUsage/updated",
      {
        threadId: "thread-parent",
        turnId: "turn-1",
        tokenUsage: {
          last: {
            totalTokens: 15,
            inputTokens: 12,
            outputTokens: 3,
          },
          modelContextWindow: 100,
        },
      },
      "run-1",
      "gpt-fixture-codex",
    );

    expect(first).toContainEqual(
      expect.objectContaining({
        type: "context_usage",
        totalTokens: 10,
        maxTokens: 100,
        percentage: 10,
      }),
    );
    expect(second).toContainEqual(
      expect.objectContaining({
        type: "context_usage",
        totalTokens: 15,
        percentage: 15,
      }),
    );
    expect(mapper.flushUsage("run-1")).toMatchObject({
      inputTokens: 12,
      outputTokens: 3,
      numTurns: 1,
      model: "gpt-fixture-codex",
    });
    expect(mapper.flushUsage("run-1")).toBeUndefined();
  });

  it("normalizes and deduplicates structured plan snapshots", () => {
    const { mapper, state } = createHarness();
    state.turnId = "turn-1";
    const params = {
      turnId: "turn-1",
      explanation: "Executing the agreed plan",
      plan: [
        { step: "Inspect", status: "completed" },
        { step: "Implement", status: "inProgress" },
        { step: "Verify", status: "pending" },
      ],
    };

    const first = mapper.mapNotification(
      "turn/plan/updated",
      params,
      "run-1",
    );
    const duplicate = mapper.mapNotification(
      "turn/plan/updated",
      params,
      "run-1",
    );

    expect(first).toEqual([{
      type: "plan_update",
      providerTurnId: "turn-1",
      explanation: "Executing the agreed plan",
      steps: [
        { step: "Inspect", status: "completed" },
        { step: "Implement", status: "in_progress" },
        { step: "Verify", status: "pending" },
      ],
    }]);
    expect(duplicate).toEqual([]);
  });

  it("filters sub-thread items into one heartbeat event", () => {
    const state = createRunState();
    state.subAgents.set("thread-child", {
      threadId: "thread-child",
      nickname: "Scout",
      role: "researcher",
    });
    const { mapper } = createHarness(state);

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-child",
        item: {
          id: "child-command",
          type: "commandExecution",
          command: "npm test",
          status: "completed",
        },
      },
      "run-1",
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "artifact",
        content: "Subagent Scout (researcher) working…",
        ephemeral: true,
        streamId:
          "codex-cmd-subagent-run-1-thread-child",
      }),
    ]);
  });

  it("projects command items into stable logical tool rows", () => {
    const { mapper } = createHarness();
    const started = mapper.mapThreadItem(
      {
        id: "command-1",
        type: "commandExecution",
        command: "rg 'needle' src",
        status: "inProgress",
      },
      "item/started",
      100,
      "run-1",
    );

    expect(started).toEqual([
      expect.objectContaining({
        type: "tool_call",
        toolName: "Grep",
        input: { pattern: "needle", path: "src" },
        metadata: expect.objectContaining({
          phase: "start",
          toolCallId: "command-1",
        }),
      }),
    ]);

    mapper.mapThreadItem(
      {
        id: "command-1",
        type: "commandExecution",
        command: "rg 'needle' src",
        aggregatedOutput: "src/example.ts:needle",
        status: "inProgress",
      },
      "item/updated",
      110,
      "run-1",
    );
    const completed = mapper.mapThreadItem(
      {
        id: "command-1",
        type: "commandExecution",
        command: "rg 'needle' src",
        exitCode: 0,
        status: "completed",
      },
      "item/completed",
      120,
      "run-1",
    );

    const toolComplete = completed.find(
      (event) =>
        event.type === "tool_call" &&
        event.metadata?.phase === "complete",
    );
    expect(toolComplete).toMatchObject({
      type: "tool_call",
      toolName: "Grep",
      input: { pattern: "needle", path: "src" },
    });
    expect(
      JSON.parse(
        (toolComplete as Extract<
          WorkRunEvent,
          { type: "tool_call" }
        >).output as string,
      ),
    ).toEqual({
      content: "src/example.ts:needle",
      numLines: 1,
    });
  });

  it("maps dynamic tool output from contentItems and success", () => {
    const { mapper } = createHarness();
    const contentItems = [
      { type: "inputText", text: '{"reviewId":"review-1"}' },
    ];

    const completed = mapper.mapThreadItem(
      {
        id: "dynamic-1",
        type: "dynamicToolCall",
        tool: "SaveReview",
        arguments: { title: "Review" },
        status: "completed",
        contentItems,
        success: true,
      },
      "item/completed",
      130,
      "run-1",
    );
    const failed = mapper.mapThreadItem(
      {
        id: "dynamic-2",
        type: "dynamicToolCall",
        tool: "SaveReview",
        arguments: { title: "Review" },
        status: "completed",
        contentItems: [
          { type: "inputText", text: "Error: persistence failed" },
        ],
        success: false,
      },
      "item/completed",
      140,
      "run-1",
    );

    expect(completed).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolName: "SaveReview",
        output: contentItems,
        error: undefined,
        metadata: expect.objectContaining({
          phase: "complete",
          success: true,
        }),
      }),
    );
    expect(failed).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        error: "Dynamic tool call failed",
        metadata: expect.objectContaining({ success: false }),
      }),
    );
  });

  it("turns a completed streamed plan into one pending Plan tool call", () => {
    const state = createRunState();
    state.planBuffers.set("plan-1", "1. Inspect\n2. Change");
    const { mapper } = createHarness(state);

    const events = mapper.mapThreadItem(
      { id: "plan-1", type: "plan", text: "stale" },
      "item/completed",
      200,
      "run-1",
    );

    expect(state.planBuffers.has("plan-1")).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({
        type: "artifact",
        content: "",
        streamId: "codex-plan-run-1-plan-1",
      }),
      expect.objectContaining({
        type: "tool_call",
        toolName: "Plan",
        input: { plan: "1. Inspect\n2. Change" },
        metadata: expect.objectContaining({ phase: "start" }),
      }),
      expect.objectContaining({
        type: "tool_call",
        toolName: "Plan",
        output: { planStatus: "pending" },
        metadata: expect.objectContaining({ phase: "complete" }),
      }),
    ]);
  });

  it("keeps review persistence outside the projection implementation", () => {
    const { mapper, onReviewCompleted } = createHarness();

    const events = mapper.mapThreadItem(
      {
        id: "review-1",
        type: "exitedReviewMode",
        review: "Review complete.",
      },
      "item/completed",
      300,
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "report",
        content: "Review complete.",
      }),
    );
    expect(onReviewCompleted).toHaveBeenCalledWith(
      "run-1",
      "review-1",
      "Review complete.",
    );
  });

  it("discovers newly-created workspace documents once", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-events-"),
    );
    tempDirs.push(tempDir);
    const documentPath = path.join(tempDir, "report.docx");
    fs.writeFileSync(documentPath, "fixture");
    const { mapper } = createHarness(createRunState(tempDir));
    const item = {
      id: "command-doc",
      type: "unknownFixtureItem",
      output: `Created ${documentPath}`,
    };

    const first = mapper.mapThreadItem(
      item,
      "item/completed",
      400,
      "run-1",
    );
    const second = mapper.mapThreadItem(
      item,
      "item/completed",
      500,
      "run-1",
    );

    expect(first).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "document",
        metadata: expect.objectContaining({
          path: documentPath,
          docType: "docx",
        }),
      }),
    );
    expect(
      second.filter(
        (event) =>
          event.type === "artifact" &&
          event.kind === "document",
      ),
    ).toHaveLength(0);
  });

  // A presentation run renders the same deck several times under its own
  // build directory before copying one out. Those copies still reach the
  // transcript — the flag is what keeps them from each taking a card beside
  // the file the answer points at.
  it("flags documents under a hidden build directory as working copies", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-working-"),
    );
    tempDirs.push(tempDir);
    fs.mkdirSync(path.join(tempDir, ".build", "pptx"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "deliverables"), { recursive: true });
    const scratch = path.join(tempDir, ".build", "pptx", "deck.pptx");
    const deliverable = path.join(tempDir, "deliverables", "deck.pptx");
    fs.writeFileSync(scratch, "fixture");
    fs.writeFileSync(deliverable, "fixture");
    const { mapper } = createHarness(createRunState(tempDir));

    const events = mapper.mapThreadItem(
      {
        id: "command-docs",
        type: "unknownFixtureItem",
        output: `Rendered ${scratch} and copied it to ${deliverable}`,
      },
      "item/completed",
      400,
      "run-1",
    );

    const byPath = new Map(
      events
        .filter((event) => event.type === "artifact" && event.kind === "document")
        .map((event) => {
          const artifact = event as Extract<WorkRunEvent, { type: "artifact" }>;
          return [artifact.metadata?.path, artifact.metadata?.working];
        }),
    );

    expect(byPath.get(scratch)).toBe(true);
    expect(byPath.get(deliverable)).toBeUndefined();
  });

  // Markdown is a deliverable too: the viewer renders it, and a written note is
  // as much the point of a turn as a written deck.
  it("cards a markdown file the run wrote", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-md-"));
    tempDirs.push(tempDir);
    const notePath = path.join(tempDir, "summary.md");
    fs.writeFileSync(notePath, "fixture");
    const { mapper } = createHarness(createRunState(tempDir));

    const events = mapper.mapThreadItem(
      {
        id: "command-md",
        type: "unknownFixtureItem",
        output: `Wrote ${notePath}`,
      },
      "item/completed",
      400,
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "document",
        metadata: expect.objectContaining({ path: notePath, docType: "md" }),
      }),
    );
  });

  // A file the agent only read is not a deliverable — the mtime gate is what
  // keeps every README in the repo out of the transcript.
  it("ignores a markdown file that predates the run", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-md-old-"));
    tempDirs.push(tempDir);
    const readmePath = path.join(tempDir, "README.md");
    fs.writeFileSync(readmePath, "fixture");
    const state = createRunState(tempDir);
    state.runStartedAt = Date.now() + 60_000;
    const { mapper } = createHarness(state);

    const events = mapper.mapThreadItem(
      {
        id: "command-md-old",
        type: "unknownFixtureItem",
        output: `Read ${readmePath}`,
      },
      "item/completed",
      400,
      "run-1",
    );

    expect(
      events.filter(
        (event) => event.type === "artifact" && event.kind === "document",
      ),
    ).toHaveLength(0);
  });

  // The run directory itself lives under ~/Library/Application Support, and
  // Codex keeps its generated images in ~/.codex — dots above the root say
  // nothing about the file.
  it("reads only the segments below the run root", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-dotroot-"));
    tempDirs.push(parent);
    const root = path.join(parent, ".hidden-run", "work");
    fs.mkdirSync(root, { recursive: true });
    const documentPath = path.join(root, "deck.pptx");
    fs.writeFileSync(documentPath, "fixture");
    const { mapper } = createHarness(createRunState(root));

    const events = mapper.mapThreadItem(
      {
        id: "command-doc-dotroot",
        type: "unknownFixtureItem",
        output: `Created ${documentPath}`,
      },
      "item/completed",
      400,
      "run-1",
    );

    const document = events.find(
      (event) => event.type === "artifact" && event.kind === "document",
    ) as Extract<WorkRunEvent, { type: "artifact" }> | undefined;
    expect(document?.metadata?.working).toBeUndefined();
  });

  // An image the agent opened to read is not something the turn produced, and
  // inline it crowded out what the turn did produce.
  it("flags a pre-existing workspace image as viewed", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-viewed-"));
    tempDirs.push(tempDir);
    const olderThanRun = path.join(tempDir, "logo.png");
    const writtenThisRun = path.join(tempDir, "chart.png");
    fs.writeFileSync(olderThanRun, "fixture");
    fs.writeFileSync(writtenThisRun, "fixture");
    const state = createRunState(tempDir);
    // Both files exist now; only one predates the run.
    state.runStartedAt = Date.now() + 60_000;
    fs.utimesSync(writtenThisRun, new Date(), new Date(state.runStartedAt));
    const { mapper } = createHarness(state);

    const events = mapper.mapThreadItem(
      {
        id: "command-images",
        type: "unknownFixtureItem",
        output: `read ${olderThanRun} and wrote ${writtenThisRun}`,
      },
      "item/completed",
      400,
      "run-1",
    );

    const byPath = new Map(
      events
        .filter((event) => event.type === "artifact" && event.kind === "image")
        .map((event) => {
          const artifact = event as Extract<WorkRunEvent, { type: "artifact" }>;
          return [artifact.metadata?.path, artifact.metadata?.viewed];
        }),
    );

    expect(byPath.get(olderThanRun)).toBe(true);
    expect(byPath.get(writtenThisRun)).toBeUndefined();
  });

  // The scan has to allow spaces — every managed run directory sits under
  // "Application Support" — which is what made a greedy match span two paths
  // and, since the span exists nowhere, drop both images.
  it("finds both images when a line names two of them", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-pair-"));
    tempDirs.push(tempDir);
    const spaced = path.join(tempDir, "Application Support");
    fs.mkdirSync(spaced);
    const first = path.join(spaced, "before.png");
    const second = path.join(spaced, "after.png");
    fs.writeFileSync(first, "fixture");
    fs.writeFileSync(second, "fixture");
    const { mapper } = createHarness(createRunState(tempDir));

    const events = mapper.mapThreadItem(
      {
        id: "command-two-images",
        type: "unknownFixtureItem",
        output: `compared ${first} with ${second}`,
      },
      "item/completed",
      400,
      "run-1",
    );

    const paths = events
      .filter((event) => event.type === "artifact" && event.kind === "image")
      .map(
        (event) =>
          (event as Extract<WorkRunEvent, { type: "artifact" }>).metadata?.path,
      );

    expect(paths).toContain(first);
    expect(paths).toContain(second);
  });
});

// Codex ends a turn by writing its follow-up chips into the message as
// remark-directive leaves. Nothing here loads remark-directive, so before this
// they were printed verbatim under every answer.
describe("Codex follow-up directives", () => {
  function messageEvents(text: string): WorkRunEvent[] {
    const { mapper } = createHarness();
    return mapper.mapThreadItem(
      { id: "item-msg", type: "agentMessage", text },
      "item/completed",
      400,
      "run-1",
    );
  }

  const MESSAGE = [
    "Your deck is ready.",
    "",
    '- :codex-followup[Make it investor-ready]{prompt="Expand this into a 6-slide investor pitch"}',
    '- :codex-followup[Create a PDF handout]{prompt="Create a matching one-page PDF handout"}',
  ].join("\n");

  it("lifts each directive onto the prompt_suggestion channel", () => {
    const suggestions = messageEvents(MESSAGE).filter(
      (event) => event.type === "prompt_suggestion",
    ) as Extract<WorkRunEvent, { type: "prompt_suggestion" }>[];

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({
      label: "Make it investor-ready",
      suggestion: "Expand this into a 6-slide investor pitch",
    });
    expect(suggestions[1]).toMatchObject({
      label: "Create a PDF handout",
      suggestion: "Create a matching one-page PDF handout",
    });
  });

  it("takes the directives out of the prose, bullet and all", () => {
    const report = messageEvents(MESSAGE).find(
      (event) => event.type === "artifact" && event.kind === "report",
    ) as Extract<WorkRunEvent, { type: "artifact" }> | undefined;

    expect(report?.content).toBe("Your deck is ready.");
  });

  it("leaves a message without directives untouched", () => {
    const events = messageEvents("Just an answer.");
    const report = events.find(
      (event) => event.type === "artifact" && event.kind === "report",
    ) as Extract<WorkRunEvent, { type: "artifact" }> | undefined;

    expect(report?.content).toBe("Just an answer.");
    expect(
      events.filter((event) => event.type === "prompt_suggestion"),
    ).toHaveLength(0);
  });

  it("keeps an escaped quote inside the prompt", () => {
    const suggestions = messageEvents(
      ':codex-followup[Quote it]{prompt="Say \\"hello\\" once"}',
    ).filter((event) => event.type === "prompt_suggestion") as Extract<
      WorkRunEvent,
      { type: "prompt_suggestion" }
    >[];

    expect(suggestions[0]?.suggestion).toBe('Say "hello" once');
  });
});

describe("Codex subagent lifecycle projection", () => {
  function spawnComplete(
    mapper: ReturnType<typeof createHarness>["mapper"],
    overrides: Record<string, unknown> = {},
  ): WorkRunEvent[] {
    return mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "item-spawn",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["thread-sub"],
          prompt: "Audit the dependencies",
          ...overrides,
        },
      },
      "run-1",
    );
  }

  it("anchors a spawned agent and emits the invoked lifecycle event", () => {
    const { mapper, state } = createHarness();
    state.subAgents.set("thread-sub", {
      threadId: "thread-sub",
      nickname: "Ada",
      role: "worker",
    });

    const events = spawnComplete(mapper);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "invoked",
        agentType: "Ada",
        agentId: "thread-sub",
        parentToolUseId: "item-spawn",
        prompt: "Audit the dependencies",
      }),
    );
    expect(state.subAgents.get("thread-sub")?.spawnItemId).toBe("item-spawn");
  });

  it.each([
    ["sendMessage", "sendCollabMessage"],
    ["followupTask", "followupCollabTask"],
    ["interruptAgent", "interruptCollabAgent"],
    ["listAgents", "listCollabAgents"],
  ])("maps the %s variant to %s", (tool, toolName) => {
    const { mapper } = createHarness();

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: `item-${tool}`,
          type: "collabAgentToolCall",
          tool,
          status: "completed",
          receiverThreadIds: [],
        },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolName,
        metadata: expect.objectContaining({
          collabTool: tool,
          collabStatus: "completed",
        }),
      }),
    );
  });

  it("marks an interrupted collab call canceled without anchoring a spawn", () => {
    const { mapper, state } = createHarness();
    state.subAgents.set("thread-sub", {
      threadId: "thread-sub",
      nickname: "Ada",
    });

    mapper.mapNotification(
      "item/started",
      {
        threadId: "thread-parent",
        item: {
          id: "item-spawn",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "inProgress",
          receiverThreadIds: ["thread-sub"],
        },
      },
      "run-1",
    );
    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "item-spawn",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "interrupted",
          receiverThreadIds: ["thread-sub"],
        },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolName: "spawnAgent",
        terminalStatus: "canceled",
        metadata: expect.objectContaining({ collabStatus: "interrupted" }),
      }),
    );
    expect(
      events.filter((event) => event.type === "subagent"),
    ).toHaveLength(0);
    expect(state.subAgents.get("thread-sub")?.spawnItemId).toBeUndefined();
  });

  it("maps a sub-thread tool item to a child tool call of the spawn", () => {
    const { mapper } = createHarness();
    spawnComplete(mapper);

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-sub",
        item: {
          id: "item-cmd",
          type: "commandExecution",
          command: "ls -la",
          status: "completed",
          exitCode: 0,
        },
      },
      "run-1",
    );

    const child = events.find((event) => event.type === "tool_call");
    expect(child).toBeDefined();
    expect(child?.metadata).toMatchObject({
      parentToolUseId: "item-spawn",
      toolCallId: "thread-sub:item-cmd",
      isFromSubagent: true,
      subThreadId: "thread-sub",
    });
    // The heartbeat still shows background activity in the loader.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        ephemeral: true,
        metadata: expect.objectContaining({ source: "codex_subagent_heartbeat" }),
      }),
    );
  });

  it("keeps non-tool sub-thread items out of the parent timeline", () => {
    const { mapper, state } = createHarness();
    spawnComplete(mapper);

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-sub",
        item: { id: "item-msg", type: "agentMessage", text: "internal chatter" },
      },
      "run-1",
    );

    expect(events.filter((event) => event.type === "tool_call")).toHaveLength(0);
    expect(state.agentMessageBuffer).toBe("");
  });

  it("settles the agent once from terminal agentsStates snapshots", () => {
    const { mapper } = createHarness();
    spawnComplete(mapper);

    const waitComplete = () =>
      mapper.mapNotification(
        "item/completed",
        {
          threadId: "thread-parent",
          item: {
            id: "item-wait",
            type: "collabAgentToolCall",
            tool: "wait",
            status: "completed",
            receiverThreadIds: ["thread-sub"],
            agentsStates: {
              "thread-sub": { status: "completed", message: "All checks passed" },
            },
          },
        },
        "run-1",
      );

    const first = waitComplete();
    const second = waitComplete();

    expect(first).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "completed",
        parentToolUseId: "item-spawn",
        result: "All checks passed",
      }),
    );
    expect(second.filter((event) => event.type === "subagent")).toHaveLength(0);
  });

  it("marks an errored agent failed with the state message", () => {
    const { mapper } = createHarness();
    spawnComplete(mapper);

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "item-close",
          type: "collabAgentToolCall",
          tool: "closeAgent",
          status: "completed",
          receiverThreadIds: ["thread-sub"],
          agentsStates: {
            "thread-sub": { status: "errored", message: "ran out of budget" },
          },
        },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "failed",
        parentToolUseId: "item-spawn",
        error: "ran out of budget",
      }),
    );
  });
});

describe("Codex multi_agent v1 (subAgentActivity) projection", () => {
  function startedActivity(
    mapper: ReturnType<typeof createHarness>["mapper"],
    id = "call_1",
    agentThreadId = "thread-sub",
  ): WorkRunEvent[] {
    return mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id,
          type: "subAgentActivity",
          kind: "started",
          agentThreadId,
          agentPath: "/root/security_review",
        },
      },
      "run-1",
    );
  }

  it("synthesizes the spawn call and invoked lifecycle from a started marker", () => {
    const { mapper, state } = createHarness();

    const events = startedActivity(mapper);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolName: "spawnAgent",
        metadata: expect.objectContaining({ phase: "start", toolCallId: "call_1" }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolName: "spawnAgent",
        metadata: expect.objectContaining({ phase: "complete", toolCallId: "call_1" }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "invoked",
        agentType: "security_review",
        agentId: "thread-sub",
        parentToolUseId: "call_1",
      }),
    );
    expect(state.subAgents.get("thread-sub")).toMatchObject({
      nickname: "security_review",
      spawnItemId: "call_1",
      settleOnTurnEnd: true,
    });
  });

  it("ignores a duplicate started marker for the same agent", () => {
    const { mapper } = createHarness();
    startedActivity(mapper);
    expect(startedActivity(mapper, "call_2")).toEqual([]);
  });

  it("persists sub-thread messages as artifacts anchored to the spawn", () => {
    const { mapper } = createHarness();
    startedActivity(mapper);

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-sub",
        item: { id: "item-msg", type: "agentMessage", text: "Interim finding." },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "report",
        content: "Interim finding.",
        metadata: expect.objectContaining({
          source: "codex_subagent_message",
          isFromSubagent: true,
          parentToolUseId: "call_1",
          subThreadId: "thread-sub",
        }),
      }),
    );
  });

  it("keeps async questions from a sub-thread in the subagent flow", () => {
    const { mapper } = createHarness();
    startedActivity(mapper);

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-sub",
        item: {
          id: "item-question",
          type: "agentMessage",
          text: "I need one choice.",
          delivery: "async",
          questions: [{ title: "Which branch?", options: ["main", "release"] }],
        },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "report",
        content: "**Which branch?**\n- main\n- release",
        metadata: expect.objectContaining({
          source: "codex_async_questions",
          isFromSubagent: true,
          parentToolUseId: "call_1",
          subThreadId: "thread-sub",
        }),
      }),
    );
  });

  it("carries the sub-thread's final message as the settle result", () => {
    const { mapper } = createHarness();
    startedActivity(mapper);

    mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-sub",
        item: {
          id: "item-msg",
          type: "agentMessage",
          text: "No security findings. Nothing actionable in the diff.",
        },
      },
      "run-1",
    );
    const events = mapper.mapNotification(
      "turn/completed",
      { threadId: "thread-sub", turn: { id: "turn-sub", status: "completed" } },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "completed",
        result: "No security findings. Nothing actionable in the diff.",
      }),
    );
  });

  it("settles an agent from an explicit completed activity exactly once", () => {
    const { mapper } = createHarness();
    startedActivity(mapper);

    mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-sub",
        item: {
          id: "item-msg",
          type: "agentMessage",
          text: "Security review complete.",
        },
      },
      "run-1",
    );
    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "call-completed",
          type: "subAgentActivity",
          kind: "completed",
          agentThreadId: "thread-sub",
          agentPath: "/root/security_review",
        },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "completed",
        agentId: "thread-sub",
        parentToolUseId: "call_1",
        result: "Security review complete.",
        metadata: expect.objectContaining({ activityKind: "completed" }),
      }),
    );

    const duplicate = mapper.mapNotification(
      "turn/completed",
      { threadId: "thread-sub", turn: { id: "turn-sub", status: "completed" } },
      "run-1",
    );
    expect(
      duplicate.filter((event) => event.type === "subagent"),
    ).toHaveLength(0);
  });

  it("settles a v1 agent when its own turn completes", () => {
    const { mapper } = createHarness();
    startedActivity(mapper);

    const events = mapper.mapNotification(
      "turn/completed",
      { threadId: "thread-sub", turn: { id: "turn-sub", status: "completed" } },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "completed",
        agentId: "thread-sub",
        parentToolUseId: "call_1",
      }),
    );
  });

  it("settles any still-open agents when the parent turn completes", () => {
    const { mapper } = createHarness();
    startedActivity(mapper);

    const events = mapper.mapNotification(
      "turn/completed",
      { threadId: "thread-parent", turn: { id: "turn-1", status: "completed" } },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "completed",
        agentId: "thread-sub",
        parentToolUseId: "call_1",
      }),
    );

    // Already settled — the next parent turn must not settle it again.
    const again = mapper.mapNotification(
      "turn/completed",
      { threadId: "thread-parent", turn: { id: "turn-2", status: "completed" } },
      "run-1",
    );
    expect(again.filter((event) => event.type === "subagent")).toHaveLength(0);
  });

  it("marks an interrupted agent stopped, not failed", () => {
    const { mapper } = createHarness();
    startedActivity(mapper);

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "call_9",
          type: "subAgentActivity",
          kind: "interrupted",
          agentThreadId: "thread-sub",
          agentPath: "/root/security_review",
        },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "stopped",
        parentToolUseId: "call_1",
      }),
    );
  });

  it("routes a registered v1 sub-thread's tool items into the flow", () => {
    const { mapper } = createHarness();
    startedActivity(mapper);

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-sub",
        item: {
          id: "item-cmd",
          type: "commandExecution",
          command: "npm audit",
          status: "completed",
          exitCode: 0,
        },
      },
      "run-1",
    );

    const child = events.find((event) => event.type === "tool_call");
    expect(child?.metadata).toMatchObject({
      parentToolUseId: "call_1",
      toolCallId: "thread-sub:item-cmd",
      isFromSubagent: true,
    });
  });
});

describe("Codex collab status normalization and sub-thread projection", () => {
  function spawnV1(mapper: ReturnType<typeof createHarness>["mapper"]) {
    mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "call_1",
          type: "subAgentActivity",
          kind: "started",
          agentThreadId: "thread-sub",
          agentPath: "/root/security_review",
        },
      },
      "run-1",
    );
  }

  it.each([undefined, "agent"])(
    "resolves a Luna nickname over the pre-registered %s placeholder",
    async (placeholderNickname) => {
      const { mapper, state } = createHarness();
      state.subAgents.set("thread-sub", {
        threadId: "thread-sub",
        nickname: placeholderNickname,
        spawnItemId: "item-spawn",
        activeTurnId: "turn-sub",
        terminalEmitted: false,
      });
      const sendRequest = vi.fn().mockResolvedValue({
        thread: {
          id: "thread-sub",
          agentNickname: "Hegel",
          agentRole: null,
        },
      });

      await mapper.maybeResolveCollabSubAgents(
        { sendRequest } as any,
        {
          threadId: "thread-parent",
          item: {
            id: "item-spawn",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            status: "completed",
            receiverThreadIds: ["thread-sub"],
          },
        },
        "run-1",
      );

      expect(sendRequest).toHaveBeenCalledWith("thread/read", {
        threadId: "thread-sub",
        includeTurns: false,
      });
      expect(state.subAgents.get("thread-sub")).toMatchObject({
        threadId: "thread-sub",
        nickname: "Hegel",
        spawnItemId: "item-spawn",
        activeTurnId: "turn-sub",
        terminalEmitted: false,
      });
    },
  );

  it("settles a v2 interrupted agent as stopped, not completed", () => {
    const { mapper, state } = createHarness();
    state.subAgents.set("thread-sub", { threadId: "thread-sub", nickname: "Ada" });
    mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "item-spawn",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["thread-sub"],
        },
      },
      "run-1",
    );

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "item-wait",
          type: "collabAgentToolCall",
          tool: "wait",
          status: "completed",
          receiverThreadIds: ["thread-sub"],
          agentsStates: {
            "thread-sub": { status: "interrupted", message: null },
          },
        },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "stopped",
        parentToolUseId: "item-spawn",
        metadata: expect.objectContaining({ collabStatus: "interrupted" }),
      }),
    );
    expect(
      events.filter((e) => e.type === "subagent" && e.phase === "completed"),
    ).toHaveLength(0);
  });

  it("keys sub-thread items by thread so parent buffers cannot collide", () => {
    const { mapper, state } = createHarness();
    spawnV1(mapper);

    // Parent buffers output for its own item "item-cmd".
    mapper.mapNotification(
      "item/updated",
      {
        threadId: "thread-parent",
        item: { id: "item-cmd", type: "commandExecution", command: "ls", aggregatedOutput: "PARENT-OUT" },
      },
      "run-1",
    );
    // Sub-thread reuses the same bare item id — must not touch parent's buffer.
    mapper.mapNotification(
      "item/updated",
      {
        threadId: "thread-sub",
        item: { id: "item-cmd", type: "commandExecution", command: "npm audit", aggregatedOutput: "CHILD-OUT" },
      },
      "run-1",
    );

    expect(state.commandOutputBuffers.get("item-cmd")).toBe("PARENT-OUT");
    expect(state.commandOutputBuffers.get("thread-sub:item-cmd")).toBe("CHILD-OUT");

    // Child completion with a sparse payload recovers output from its own buffer.
    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-sub",
        item: { id: "item-cmd", type: "commandExecution", command: "npm audit", status: "completed", exitCode: 0 },
      },
      "run-1",
    );
    const child = events.flatMap((e) => (e.type === "tool_call" ? [e] : []))[0];
    expect(child?.metadata).toMatchObject({
      toolCallId: "thread-sub:item-cmd",
      parentToolUseId: "call_1",
    });
    expect(JSON.stringify(child?.output)).toContain("CHILD-OUT");
    // Parent's buffer survived untouched.
    expect(state.commandOutputBuffers.get("item-cmd")).toBe("PARENT-OUT");
  });

  it("gives each file of a multi-file sub-thread fileChange its own id", () => {
    const { mapper } = createHarness();
    spawnV1(mapper);

    const events = mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-sub",
        item: {
          id: "item-fc",
          type: "fileChange",
          status: "completed",
          changes: [
            { path: "a.ts", kind: "update", patch: "--- a" },
            { path: "b.ts", kind: "add", patch: "--- b" },
          ],
        },
      },
      "run-1",
    );

    const completions = events.flatMap((e) =>
      e.type === "tool_call" && e.metadata?.phase === "complete" ? [e] : [],
    );
    expect(completions.map((e) => e.metadata?.toolCallId)).toEqual([
      "thread-sub:item-fc-a.ts",
      "thread-sub:item-fc-b.ts",
    ]);
    for (const completion of completions) {
      expect(completion.metadata).toMatchObject({
        parentToolUseId: "call_1",
        isFromSubagent: true,
      });
    }
  });
});

describe("Codex turn-status settlement", () => {
  function spawnV1(mapper: ReturnType<typeof createHarness>["mapper"]) {
    mapper.mapNotification(
      "item/completed",
      {
        threadId: "thread-parent",
        item: {
          id: "call_1",
          type: "subAgentActivity",
          kind: "started",
          agentThreadId: "thread-sub",
          agentPath: "/root/security_review",
        },
      },
      "run-1",
    );
  }

  it("settles a failed sub-thread turn as failed with the turn's error", () => {
    const { mapper } = createHarness();
    spawnV1(mapper);

    const events = mapper.mapNotification(
      "turn/completed",
      {
        threadId: "thread-sub",
        turn: { id: "turn-sub", status: "failed", error: { message: "model overloaded" } },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "failed",
        parentToolUseId: "call_1",
        error: "model overloaded",
      }),
    );
  });

  it("settles an interrupted sub-thread turn as stopped, not completed", () => {
    const { mapper } = createHarness();
    spawnV1(mapper);

    const events = mapper.mapNotification(
      "turn/completed",
      { threadId: "thread-sub", turn: { id: "turn-sub", status: "interrupted" } },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "stopped",
        parentToolUseId: "call_1",
      }),
    );
    expect(
      events.filter((e) => e.type === "subagent" && e.phase === "completed"),
    ).toHaveLength(0);
  });

  it("settles agents cut short by a failed parent turn as stopped", () => {
    const { mapper } = createHarness();
    spawnV1(mapper);

    const events = mapper.mapNotification(
      "turn/completed",
      {
        threadId: "thread-parent",
        turn: { id: "turn-1", status: "failed", error: { message: "boom" } },
      },
      "run-1",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        phase: "stopped",
        agentId: "thread-sub",
        parentToolUseId: "call_1",
      }),
    );
    expect(
      events.filter((e) => e.type === "subagent" && e.phase === "completed"),
    ).toHaveLength(0);
  });
});

describe("Codex existing-agent re-arm", () => {
  it.each(["resumeAgent", "followupTask"])(
    "%s flips a settled agent back to running and lets it settle again once",
    (reactivateTool) => {
      const { mapper, state } = createHarness();
      state.subAgents.set("thread-sub", {
        threadId: "thread-sub",
        nickname: "Ada",
      });

      const collab = (id: string, tool: string, agentStatus?: string) =>
        mapper.mapNotification(
          "item/completed",
          {
            threadId: "thread-parent",
            item: {
              id,
              type: "collabAgentToolCall",
              tool,
              status: "completed",
              receiverThreadIds: ["thread-sub"],
              ...(agentStatus
                ? {
                    agentsStates: {
                      "thread-sub": { status: agentStatus, message: null },
                    },
                  }
                : {}),
            },
          },
          "run-1",
        );

      collab("item-spawn", "spawnAgent");
      collab("item-close", "closeAgent", "shutdown"); // settled as completed
      expect(state.subAgents.get("thread-sub")?.terminalPhase).toBe("completed");

      const resumed = collab("item-reactivate", reactivateTool);
      expect(resumed).toContainEqual(
        expect.objectContaining({
          type: "subagent",
          phase: "running",
          // Re-armed on the ORIGINAL anchor, not the resume call.
          parentToolUseId: "item-spawn",
        }),
      );
      expect(state.subAgents.get("thread-sub")?.terminalEmitted).toBe(false);
      expect(state.subAgents.get("thread-sub")?.terminalPhase).toBeUndefined();

      const settledAgain = collab("item-close-2", "closeAgent", "completed");
      expect(settledAgain).toContainEqual(
        expect.objectContaining({
          type: "subagent",
          phase: "completed",
          parentToolUseId: "item-spawn",
        }),
      );
    },
  );
});

// Drift guard: every type in the sub-thread allowlist must have a
// mapThreadItem case that actually yields a child tool_call — adding a type
// to the set without a mapper case (or removing a case the set relies on)
// breaks here instead of silently dropping subagent activity.
describe("SUB_THREAD_TOOL_ITEM_TYPES ↔ mapThreadItem drift", () => {
  const PAYLOADS: Record<string, Record<string, unknown>> = {
    commandexecution: { command: "ls -la", status: "completed", exitCode: 0 },
    fileread: { path: "a.ts", status: "completed" },
    filechange: {
      status: "completed",
      changes: [{ path: "a.ts", kind: "update", patch: "--- d" }],
    },
    mcptoolcall: { server: "srv", tool: "doThing", arguments: {}, status: "completed" },
    websearch: { query: "docs" },
    dynamictoolcall: { tool: "MyTool", arguments: {}, status: "completed" },
  };

  it.each([...SUB_THREAD_TOOL_ITEM_TYPES])(
    "%s routes to a child tool_call",
    (itemType) => {
      const payload = PAYLOADS[itemType.toLowerCase().replace(/_/g, "")];
      expect(payload, `add a payload for ${itemType}`).toBeDefined();

      const { mapper } = createHarness();
      mapper.mapNotification(
        "item/completed",
        {
          threadId: "thread-parent",
          item: {
            id: "call_1",
            type: "subAgentActivity",
            kind: "started",
            agentThreadId: "thread-sub",
            agentPath: "/root/reviewer",
          },
        },
        "run-1",
      );

      const events = mapper.mapNotification(
        "item/completed",
        {
          threadId: "thread-sub",
          item: { id: "item-x", type: itemType, ...payload },
        },
        "run-1",
      );

      const children = events.filter(
        (e) =>
          e.type === "tool_call" &&
          e.metadata?.parentToolUseId === "call_1" &&
          e.metadata?.isFromSubagent === true,
      );
      expect(children.length).toBeGreaterThan(0);
    },
  );
});
