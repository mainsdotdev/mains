import { describe, expect, it } from "vitest";
import {
  selectTaskPresentation,
  type SubagentMetadata,
  type TaskMetadata,
} from "./task-progress-strip";

// Payloads mirror what the Claude CLI actually produces: a `sleep` backgrounded
// into a local_bash task (summary echoes the description, real output lives in
// the file) and an Agent subagent task (summary IS the report).
const BASH_TASK: TaskMetadata = {
  phase: "completed",
  taskId: "b48vti1p7",
  status: "stopped",
  description: "Sleep 40 seconds then print finished-ok",
  summary: "Sleep 40 seconds then print finished-ok",
  taskType: "local_bash",
  outputFile: "/tmp/tasks/b48vti1p7.output",
};

const AGENT_TASK: TaskMetadata = {
  phase: "completed",
  taskId: "a33744e7",
  status: "completed",
  description: "Count files in /tmp",
  subagentType: "general-purpose",
  taskType: "local_agent",
  summary: "The count is 7.\n\nI ran `ls -1 /tmp | wc -l`.",
  outputFile: "/tmp/tasks/a33744e7.output",
  usage: { totalTokens: 17155, toolUses: 1, durationMs: 4107 },
};

describe("selectTaskPresentation", () => {
  it("renders nothing without metadata", () => {
    expect(selectTaskPresentation(undefined, undefined)).toBeNull();
  });

  it("hides tasks the provider flagged as ambient housekeeping", () => {
    expect(
      selectTaskPresentation({ ...AGENT_TASK, skipTranscript: true }),
    ).toBeNull();
  });

  it("treats a subagent summary as an expandable report", () => {
    const view = selectTaskPresentation(AGENT_TASK)!;
    expect(view.tone).toBe("ok");
    expect(view.label).toBe("Subagent finished");
    expect(view.detail).toBe("The count is 7.\n\nI ran `ls -1 /tmp | wc -l`.");
    expect(view.context).toBe("17.2k tokens · 1 tool · 4.1s");
  });

  // The summary of a backgrounded command just echoes its description — showing
  // it as a body would be a duplicate line that says nothing new.
  it("does not treat an echoed description as a report", () => {
    const view = selectTaskPresentation(BASH_TASK)!;
    expect(view.detail).toBeUndefined();
    expect(view.label).toBe("Background task stopped");
    expect(view.tone).toBe("warn");
    // The real output is only reachable through the captured file.
    expect(view.outputFile).toBe("/tmp/tasks/b48vti1p7.output");
  });

  it("falls back to the subagent result when the task carries no report", () => {
    const subagent: SubagentMetadata = {
      phase: "completed",
      agentType: "general-purpose",
      result: "Reviewed 3 files, no issues.",
    };
    const view = selectTaskPresentation(
      { ...AGENT_TASK, summary: undefined },
      subagent,
    )!;
    expect(view.detail).toBe("Reviewed 3 files, no issues.");
  });

  it("renders from subagent metadata alone", () => {
    const view = selectTaskPresentation(undefined, {
      phase: "completed",
      result: "done",
    })!;
    expect(view.detail).toBe("done");
  });

  it("prefers the error over any report", () => {
    const view = selectTaskPresentation({
      ...AGENT_TASK,
      status: "failed",
      error: "subagent crashed",
    })!;
    expect(view.tone).toBe("error");
    expect(view.label).toBe("Subagent failed");
    expect(view.detail).toBe("subagent crashed");
  });

  it("reads as running until a terminal phase lands", () => {
    const view = selectTaskPresentation({
      phase: "progress",
      taskId: "t1",
      status: "running",
      description: "Count files in /tmp",
      subagentType: "general-purpose",
      lastToolName: "Bash",
      usage: { totalTokens: 16483, toolUses: 1, durationMs: 1881 },
    })!;
    expect(view.tone).toBe("running");
    expect(view.label).toBe("Subagent working");
    expect(view.context).toBe("Bash · 16.5k tokens · 1 tool · 1.9s");
  });

  it("labels a backgrounded command differently from a subagent", () => {
    const view = selectTaskPresentation({
      phase: "started",
      taskId: "t2",
      status: "running",
      taskType: "local_bash",
      description: "npm run build",
    })!;
    expect(view.label).toBe("Running in background");
  });
});
