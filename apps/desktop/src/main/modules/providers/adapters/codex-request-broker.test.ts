import { describe, expect, it, vi } from "vitest";
import type {
  ToolApprovalRequest,
  ToolApprovalResponse,
} from "../../runs/runs.dto";
import {
  createCodexRequestBroker,
  type CodexRequestRunState,
  type CodexServerResponder,
} from "./codex-request-broker";

function createResponder() {
  const responses: Array<{
    id: number | string;
    result: unknown;
  }> = [];
  const errors: Array<{
    id: number | string;
    code: number;
    message: string;
  }> = [];
  const server: CodexServerResponder = {
    respondToRequest: (id, result) => {
      responses.push({ id, result });
    },
    respondToRequestError: (id, code, message) => {
      errors.push({ id, code, message });
    },
  };
  return { errors, responses, server };
}

function createHarness(
  approval: (
    request: ToolApprovalRequest,
  ) => Promise<ToolApprovalResponse> = async (request) => ({
    requestId: request.requestId,
    approved: true,
    answer: "acceptForSession",
  }),
) {
  const runState: CodexRequestRunState = {
    fileChangeItems: new Map(),
    approvedElicitationServers: new Set(),
  };
  const requestApproval = vi.fn(approval);
  const checkCommand = vi.fn(async () => ({ blocked: false }));
  const dispatchTool = vi.fn(async () => ({
    content: [{ type: "text" as const, text: "tool-result" }],
    isError: false,
  }));
  const openExternal = vi.fn(async () => undefined);
  const broker = createCodexRequestBroker({
    getRunState: (runId) =>
      runId === "run-1" ? runState : undefined,
    getMainsToolContext: (runId) =>
      runId === "run-1"
        ? {
            workspaceId: "workspace-1",
            rootPath: "/workspace",
            runId: "run-1",
          }
        : undefined,
    requestApproval,
    checkCommand,
    dispatchTool,
    openExternal,
    now: () => 1_720_000_000_000,
  });
  return {
    broker,
    checkCommand,
    dispatchTool,
    openExternal,
    requestApproval,
    runState,
  };
}

async function handle(
  broker: ReturnType<typeof createCodexRequestBroker>,
  server: CodexServerResponder,
  method: string,
  params: unknown = {},
  runIsDead = false,
) {
  await broker.handleRequest({
    server,
    id: 42,
    method,
    params,
    runId: "run-1",
    runIsDead,
  });
}

describe("Codex request broker", () => {
  it("declines UI requests from dead or inactive runs without prompting", async () => {
    const { broker, requestApproval } = createHarness();
    const dead = createResponder();
    const inactive = createResponder();

    await handle(
      broker,
      dead.server,
      "item/commandExecution/requestApproval",
      { command: "npm install unsafe-package" },
      true,
    );
    broker.rejectInactive(
      inactive.server,
      "request-2",
      "mcpServer/elicitation/request",
    );

    expect(dead.responses).toEqual([
      { id: 42, result: { decision: "decline" } },
    ]);
    expect(inactive.responses).toEqual([
      {
        id: "request-2",
        result: {
          action: "cancel",
          content: null,
          _meta: null,
        },
      },
    ]);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("forwards network approvals and preserves session decisions", async () => {
    const { broker, checkCommand, requestApproval } =
      createHarness();
    const responder = createResponder();

    await handle(
      broker,
      responder.server,
      "item/commandExecution/requestApproval",
      {
        command: "",
        reason: "Fetch dependency metadata",
        networkApprovalContext: {
          host: "registry.npmjs.org",
          protocol: "https",
        },
        proposedNetworkPolicyAmendments: ["registry.npmjs.org"],
      },
    );

    expect(checkCommand).not.toHaveBeenCalled();
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "42",
        runId: "run-1",
        toolName: "Bash",
        toolInput: expect.objectContaining({
          command:
            "Network access: https://registry.npmjs.org",
          description: "Fetch dependency metadata",
          networkApprovalContext: {
            host: "registry.npmjs.org",
            protocol: "https",
          },
        }),
        timestamp: 1_720_000_000_000,
      }),
    );
    expect(responder.responses).toEqual([
      { id: 42, result: { decision: "acceptForSession" } },
    ]);
  });

  it("lets the dependency guard decline commands before UI approval", async () => {
    const { broker, checkCommand, requestApproval } =
      createHarness();
    checkCommand.mockResolvedValue({ blocked: true });
    const responder = createResponder();

    await handle(
      broker,
      responder.server,
      "item/commandExecution/requestApproval",
      { command: "npm install suspicious-package" },
    );

    expect(checkCommand).toHaveBeenCalledWith(
      "npm install suspicious-package",
    );
    expect(requestApproval).not.toHaveBeenCalled();
    expect(responder.responses).toEqual([
      { id: 42, result: { decision: "decline" } },
    ]);
  });

  it("enriches file approvals from the cached file-change item", async () => {
    const { broker, requestApproval, runState } =
      createHarness();
    runState.fileChangeItems.set("change-1", [
      {
        path: "src/index.ts",
        kind: "update",
        diff: "@@ -1 +1 @@",
      },
    ]);
    const responder = createResponder();

    await handle(
      broker,
      responder.server,
      "item/fileChange/requestApproval",
      { itemId: "change-1", reason: "Apply requested fix" },
    );

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "Edit",
        toolInput: {
          file_path: "src/index.ts",
          diff: "@@ -1 +1 @@",
          description: "Apply requested fix",
        },
      }),
    );
    expect(responder.responses[0]?.result).toEqual({
      decision: "acceptForSession",
    });
  });

  it("collects structured answers and stops prompting after a dismissal", async () => {
    const approval = vi
      .fn<
        (
          request: ToolApprovalRequest,
        ) => Promise<ToolApprovalResponse>
      >()
      .mockResolvedValueOnce({
        requestId: "42-q0",
        approved: true,
        answer: "Alpha, Beta",
      })
      .mockResolvedValueOnce({
        requestId: "42-q1",
        approved: false,
      });
    const { broker, requestApproval } =
      createHarness(approval);
    const responder = createResponder();

    await handle(
      broker,
      responder.server,
      "item/tool/requestUserInput",
      {
        autoResolutionMs: 60_000,
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which packages?",
            options: [
              { label: "Alpha", description: "First" },
              { label: "Beta", description: "Second" },
            ],
          },
          {
            id: "confirm",
            question: "Continue?",
          },
          {
            id: "notes",
            question: "Anything else?",
          },
        ],
      },
    );

    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(requestApproval).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        requestId: "42-q0",
        kind: "ask_user",
        autoResolutionMs: 60_000,
      }),
    );
    expect(responder.responses).toEqual([
      {
        id: 42,
        result: {
          answers: {
            scope: { answers: ["Alpha", "Beta"] },
            confirm: { answers: [] },
            notes: { answers: [] },
          },
        },
      },
    ]);
  });

  it("dispatches known dynamic tools and rejects unknown ones", async () => {
    const { broker, dispatchTool } = createHarness();
    const known = createResponder();
    const unknown = createResponder();

    await handle(broker, known.server, "item/tool/call", {
      tool: "CheckPackage",
      arguments: JSON.stringify({
        packageName: "react",
        packageManager: "npm",
      }),
      threadId: "thread-child",
    });
    await handle(
      broker,
      unknown.server,
      "item/tool/call",
      { tool: "NotAMainsTool" },
    );

    expect(dispatchTool).toHaveBeenCalledWith(
      "CheckPackage",
      {
        packageName: "react",
        packageManager: "npm",
      },
      {
        workspaceId: "workspace-1",
        rootPath: "/workspace",
        runId: "run-1",
      },
    );
    expect(known.responses).toEqual([
      {
        id: 42,
        result: {
          contentItems: [
            { type: "inputText", text: "tool-result" },
          ],
          success: true,
        },
      },
    ]);
    expect(unknown.errors).toEqual([
      {
        id: 42,
        code: -32601,
        message: "Unknown dynamic tool: NotAMainsTool",
      },
    ]);
  });

  it("only caches form elicitation approvals that need no values", async () => {
    const { broker, requestApproval, runState } =
      createHarness();
    const required = createResponder();
    const optional = createResponder();
    const cached = createResponder();

    await handle(
      broker,
      required.server,
      "mcpServer/elicitation/request",
      {
        serverName: "Calendar",
        mode: "form",
        requestedSchema: { required: ["title"] },
      },
    );
    await handle(
      broker,
      optional.server,
      "mcpServer/elicitation/request",
      {
        serverName: "Calendar",
        mode: "form",
        requestedSchema: { required: [] },
      },
    );
    await handle(
      broker,
      cached.server,
      "mcpServer/elicitation/request",
      {
        serverName: "Calendar",
        mode: "form",
        requestedSchema: { required: [] },
      },
    );

    expect(required.responses[0]?.result).toEqual({
      action: "decline",
      content: null,
      _meta: null,
    });
    expect(optional.responses[0]?.result).toEqual({
      action: "accept",
      content: {},
      _meta: null,
    });
    expect(cached.responses[0]?.result).toEqual({
      action: "accept",
      content: {},
      _meta: null,
    });
    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(
      runState.approvedElicitationServers?.has("calendar"),
    ).toBe(true);
  });

  it("returns protocol-safe time and auth fallback responses", async () => {
    const { broker } = createHarness();
    const time = createResponder();
    const auth = createResponder();

    await handle(
      broker,
      time.server,
      "currentTime/read",
    );
    await handle(
      broker,
      auth.server,
      "account/chatgptAuthTokens/refresh",
    );

    expect(time.responses).toEqual([
      {
        id: 42,
        result: { currentTimeAt: 1_720_000_000 },
      },
    ]);
    expect(auth.errors).toEqual([
      {
        id: 42,
        code: -32601,
        message:
          "Client does not manage ChatGPT tokens; use auth.json fallback",
      },
    ]);
  });
});
