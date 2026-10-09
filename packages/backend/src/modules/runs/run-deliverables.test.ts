import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunArtifactResponse } from "./runs.dto";
import type { RunTurnResponse, ToolCallResponse } from "@mains/contracts/runs";
import { projectRunDeliverables } from "./run-deliverables";

let root: string;
const at = (second: number) => new Date(second * 1000);
const report = (id: number, content: string, turnId = 1, metadata = {}): RunArtifactResponse => ({
  id, runId: "r", kind: "report", content, path: null, blobData: null, entityId: null, contentHash: null,
  createdAt: at(id), metadata: { turnId, ...metadata },
});
const call = (id: number, input: Record<string, unknown>, turnId = 1): ToolCallResponse => ({
  id, runId: "r", toolId: `tool-${id}`, parentToolCallId: null, toolName: "Write", status: "done",
  input, output: null, error: null, startedAt: at(id), endedAt: at(id), createdAt: at(id), updatedAt: at(id), metadata: { turnId },
});
const turn = (id: number, status: "active" | "completed" = "completed"): RunTurnResponse => ({
  id, runId: "r", turnIndex: id - 1, promptContent: null, responseContent: null, status,
  startedAt: at(0), endedAt: status === "completed" ? at(100) : null, elapsedMs: null, model: null, createdAt: at(0),
});
function file(name: string) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "output");
  return target;
}
const project = (artifacts: RunArtifactResponse[], toolCalls: ToolCallResponse[] = [], turns = [turn(1)], terminal = true) =>
  projectRunDeliverables({ runId: "r", artifacts, toolCalls, turns, root, terminal });
const outputs = (rows: RunArtifactResponse[]) => rows.filter((row) => row.metadata?.outputSelected);

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-deliverables-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("per-turn deliverables", () => {
  it("selects exactly the last two logical messages and calls, without a filename blacklist", async () => {
    ["early.md", "CONTEXT.md", "last.md", "early-tool.pdf", "last-tool.pdf", "other-tool.pdf"].forEach(file);
    const artifacts = [report(1, "early.md"), report(2, "CONTEXT.md"), report(3, "last.md")];
    const tools = [call(1, { path: "early-tool.pdf" }), call(2, { path: "last-tool.pdf" }), call(3, { path: "other-tool.pdf" })];
    expect(outputs(await project(artifacts, tools)).map((row) => row.metadata?.fileName).sort())
      .toEqual(["CONTEXT.md", "last-tool.pdf", "last.md", "other-tool.pdf"].sort());
  });
  it("counts multipart provider messages once and excludes subagent prose/tools", async () => {
    ["early.md", "part-one.md", "part-two.md", "final.md", "child.md", "tool.md"].forEach(file);
    const artifacts = [report(1, "early.md"), report(2, "part-one.md", 1, { providerMessageId: "m" }),
      report(3, "part-two.md", 1, { providerMessageId: "m" }), report(4, "final.md"),
      report(5, "child.md", 1, { isFromSubagent: true }), report(6, "child.md", 1, { kind: "thinking" })];
    const child = { ...call(3, { path: "child.md" }), parentToolCallId: "spawn" };
    expect(outputs(await project(artifacts, [call(1, { path: "tool.md" }), child])).map((row) => row.metadata?.fileName).sort())
      .toEqual(["part-one.md", "part-two.md", "final.md", "tool.md"].sort());
  });
  it("counts duplicate lifecycle records as one logical tool call", async () => {
    ["early.md", "middle.md", "last.md"].forEach(file);
    const first = call(1, { path: "early.md" });
    const middle = call(2, { path: "middle.md" });
    const last = call(3, { path: "last.md" });
    const duplicate = { ...call(4, { path: "last.md" }), toolId: last.toolId };
    expect(outputs(await project([], [first, middle, last, duplicate])).map((row) => row.metadata?.fileName))
      .toEqual(["middle.md", "last.md"]);
  });
  it("deduplicates canonical paths and accepts a file first discovered early when delivered again", async () => {
    const target = file("My report.md");
    const candidate = { ...report(1, ""), kind: "document" as const, path: target, metadata: { path: target } };
    const artifacts = [candidate, report(2, "Progress"), report(3, `[Report](<${target}>)`), report(4, "[Again](My%20report.md)")];
    const result = outputs(await project(artifacts, [call(1, { path: "./My report.md" })]));
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(fs.realpathSync(target));
    expect(outputs(await project(artifacts, [call(1, { path: target })]))[0].id).toBe(result[0].id);
  });
  it("retains each completed turn's outputs while a follow-up is still running", async () => {
    file("first.md"); file("second.md"); file("unfinished.md");
    const artifacts = [report(1, "first.md", 1), report(2, "second.md", 2), report(3, "unfinished.md", 3)];
    expect(outputs(await project(artifacts, [], [turn(1), turn(2), turn(3, "active")], false)).map((row) => row.metadata?.fileName))
      .toEqual(["first.md", "second.md"]);
  });
  it("keeps an earlier turn's image identity when a follow-up writes to the same path", async () => {
    const target = file("image.png");
    const image = (id: number, turnId: number) => ({ ...report(id, "", turnId), kind: "image" as const, path: target,
      metadata: { turnId, path: target } });
    const first = [image(1, 1), report(2, "![Result](image.png)", 1)];
    const before = outputs(await project(first));
    const after = outputs(await project([...first, image(3, 2), report(4, "![Updated](image.png)", 2)], [], [turn(1), turn(2)]));
    expect(after.map((row) => row.id)).toEqual([before[0].id, 3]);
  });
  it("uses prompt boundaries for legacy history and does not split on steering", async () => {
    ["first.md", "second.md", "early.md"].forEach(file);
    const prompt = (id: number, delivery?: string) => ({ ...report(id, "prompt"), kind: "user-prompt" as "report", metadata: { delivery } });
    const legacy = (id: number, content: string) => ({ ...report(id, content), metadata: null });
    const artifacts = [prompt(1), legacy(2, "first.md"), prompt(3), legacy(4, "early.md"), prompt(5, "steer"), legacy(6, "second.md"), legacy(7, "Done")];
    expect(outputs(await project(artifacts, [], [])).map((row) => row.metadata?.fileName)).toEqual(["first.md", "second.md"]);
  });
  it("excludes missing files, symlinks, outside paths, URLs and unreferenced folder files", async () => {
    file("unmentioned.md");
    const outside = path.join(path.dirname(root), "outside-deliverable.md");
    fs.writeFileSync(outside, "outside");
    fs.symlinkSync(outside, path.join(root, "link.md"));
    try {
      expect(outputs(await project([report(1, `missing.md link.md ${outside} https://example.com/unmentioned.md`)]))).toEqual([]);
    } finally { fs.rmSync(outside, { force: true }); }
  });
  it.each(["![Result](image.png)", "![Result](image.png \"Preview\")", "![Result][img]\n\n[img]: image.png"])(
    "keeps inline Markdown images in the common output set without a second image card: %s", async (markdown) => {
    const target = file("image.png");
    const image = { ...report(1, ""), kind: "image" as const, path: target, metadata: { path: target } };
    const result = outputs(await project([image, report(2, markdown)]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(image.id);
    expect(result[0].metadata?.inlineInReport).toBe(true);
  });
});
