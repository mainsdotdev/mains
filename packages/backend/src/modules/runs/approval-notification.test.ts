import { describe, expect, it } from "vitest";
import {
  approvalNotificationMode,
  describeApprovalNotification,
  responseFromNotification,
} from "./approval-notification";
import type { ToolApprovalRequest } from "./runs.dto";

const request = (overrides: Partial<ToolApprovalRequest> = {}): ToolApprovalRequest => ({
  requestId: "req-1",
  runId: "run-1",
  toolName: "Bash",
  kind: "tool_approval",
  timestamp: 0,
  ...overrides,
});

describe("approvalNotificationMode", () => {
  it("offers Allow / Deny for a tool permission", () => {
    expect(approvalNotificationMode(request())).toBe("approve");
  });

  it("leaves the plan review to the app, whatever the spelling", () => {
    for (const toolName of ["ExitPlanMode", "exit_plan_mode", "exit-plan-mode"]) {
      expect(approvalNotificationMode(request({ toolName }))).toBe("open");
    }
  });

  it("answers a short single-choice question with its options", () => {
    const req = request({
      kind: "ask_user",
      question: "Which?",
      options: [{ label: "A" }, { label: "B" }],
    });
    expect(approvalNotificationMode(req)).toBe("choose");
  });

  it("answers an open question with the reply field", () => {
    expect(approvalNotificationMode(request({ kind: "ask_user", question: "Why?" }))).toBe(
      "reply",
    );
  });

  it("sends everything the notification can't answer to the app", () => {
    const options = [{ label: "A" }, { label: "B" }];
    const cases: Array<Partial<ToolApprovalRequest>> = [
      { kind: "ask_user", options, multiSelect: true },
      { kind: "ask_user", isSecret: true },
      {
        kind: "ask_user",
        options: ["1", "2", "3", "4", "5"].map((label) => ({ label })),
      },
      { kind: "elicitation", serverName: "github", elicitationMode: "form" },
    ];
    for (const overrides of cases) {
      expect(approvalNotificationMode(request(overrides))).toBe("open");
    }
  });
});

describe("describeApprovalNotification", () => {
  it("keeps a tool permission to headings: the tool, and the run as subtitle", () => {
    const spec = describeApprovalNotification(
      request({ toolInput: { command: "git push origin main", description: "Push" } }),
      "  Ship the release  ",
    );
    expect(spec).toEqual({
      mode: "approve",
      title: "Allow Bash?",
      subtitle: "Ship the release",
      body: "",
      actions: ["Allow", "Deny"],
      hasReply: false,
    });
  });

  it("gives MCP tools and copilot permissions a readable name", () => {
    expect(
      describeApprovalNotification(request({ toolName: "mcp__github__create_issue" })).title,
    ).toBe("Allow create_issue (github)?");
    expect(
      describeApprovalNotification(
        request({ toolName: "[permission:shell]", question: 'Copilot requests "shell" permission' }),
      ),
    ).toMatchObject({ title: "Allow shell permission?", body: "" });
  });

  it("flattens and truncates a long question", () => {
    const spec = describeApprovalNotification(
      request({ kind: "ask_user", question: `Line one\n${"x".repeat(500)}` }),
    );
    expect(spec.body).toHaveLength(200);
    expect(spec.body.startsWith("Line one x")).toBe(true);
    expect(spec.body.endsWith("…")).toBe(true);
  });

  it("puts the question in the body and the options on the buttons", () => {
    const spec = describeApprovalNotification(
      request({
        kind: "ask_user",
        header: "Database",
        question: "Which engine?",
        options: [{ label: "SQLite" }, { label: "Postgres" }],
      }),
    );
    expect(spec).toMatchObject({
      mode: "choose",
      title: "Database",
      body: "Which engine?",
      actions: ["SQLite", "Postgres"],
      hasReply: false,
    });
    expect(spec).not.toHaveProperty("subtitle");
  });

  it("offers no buttons where the app has to answer", () => {
    const spec = describeApprovalNotification(
      request({ toolName: "ExitPlanMode", toolInput: { plan: "1. Do it" } }),
    );
    expect(spec).toMatchObject({
      title: "Plan ready for review",
      body: "",
      actions: [],
      hasReply: false,
    });
  });
});

describe("responseFromNotification", () => {
  it("maps Allow and Deny", () => {
    const req = request();
    expect(responseFromNotification(req, { type: "action", index: 0 })).toEqual({
      requestId: "req-1",
      approved: true,
    });
    expect(responseFromNotification(req, { type: "action", index: 1 })).toEqual({
      requestId: "req-1",
      approved: false,
    });
    expect(responseFromNotification(req, { type: "action", index: 2 })).toBeNull();
  });

  it("answers a choice with the option label, as the dialog does", () => {
    const req = request({
      kind: "ask_user",
      options: [{ label: "SQLite" }, { label: "Postgres" }],
    });
    expect(responseFromNotification(req, { type: "action", index: 1 })).toEqual({
      requestId: "req-1",
      approved: true,
      answer: "Postgres",
    });
    expect(responseFromNotification(req, { type: "action", index: 5 })).toBeNull();
  });

  it("answers an open question with the trimmed reply, never an empty one", () => {
    const req = request({ kind: "ask_user", question: "Why?" });
    expect(responseFromNotification(req, { type: "reply", text: "  because  " })).toEqual({
      requestId: "req-1",
      approved: true,
      answer: "because",
    });
    expect(responseFromNotification(req, { type: "reply", text: "   " })).toBeNull();
  });

  it("settles nothing the notification can't answer", () => {
    const plan = request({ toolName: "ExitPlanMode" });
    expect(responseFromNotification(plan, { type: "action", index: 0 })).toBeNull();
    expect(responseFromNotification(request(), { type: "reply", text: "yes" })).toBeNull();
  });
});
