import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunArtifactResponse } from "./runs.dto";
import type { RunTurnResponse } from "@mains/contracts/runs";
import { projectRunDeliverables } from "./run-deliverables";

let root: string;
const at = (second: number) => new Date(second * 1000);
const report = (id: number, content: string, turnId = 1, metadata = {}): RunArtifactResponse => ({
  id, runId: "r", kind: "report", content, path: null, blobData: null, entityId: null, contentHash: null,
  createdAt: at(id), metadata: { turnId, ...metadata },
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
const project = (artifacts: RunArtifactResponse[], turns = [turn(1)], terminal = true) =>
  projectRunDeliverables({ runId: "r", artifacts, turns, root, terminal });
const outputs = (rows: RunArtifactResponse[]) => rows.filter((row) => row.metadata?.outputSelected);

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-deliverables-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("per-turn final-answer deliverables", () => {
  it.each([
    ["report (v2).pptx", "[Deck](report%20(v2).pptx)"],
    ["Bob's report.docx", "Created `Bob's report.docx`."],
    ["summary.md", "[Summary](summary.md#overview)"],
    ["report.pdf", "[PDF](report.pdf?download=1)"],
    ["summary#draft.md", "[Summary](summary%23draft.md)"],
  ])("resolves the complete Markdown reference to %s", async (name, message) => {
    file(name);
    expect(outputs(await project([report(1, message)])).map((row) => row.metadata?.fileName)).toEqual([name]);
  });
  it("does not discover an unrelated basename inside a linked filename", async () => {
    file("My report.docx"); file("report.docx");
    expect(outputs(await project([report(1, "[Word](<My report.docx>)")])).map((row) => row.metadata?.fileName))
      .toEqual(["My report.docx"]);
  });
  it("keeps a quoted prose path intact without discovering its basename", async () => {
    file("My report.docx"); file("report.docx");
    expect(outputs(await project([report(1, 'Created "My report.docx".')])).map((row) => row.metadata?.fileName))
      .toEqual(["My report.docx"]);
  });
  it.each(["draft#v1.md", "report%20.docx", "notes?draft.md"])("retains the literal registered filename %s", async (name) => {
    const target = file(name);
    const artifact = { ...report(1, ""), kind: "document" as const, path: target,
      metadata: { turnId: 1, path: target, outputRole: "deliverable" } };
    expect(outputs(await project([artifact])).map((row) => row.path)).toEqual([fs.realpathSync(target)]);
    expect(outputs(await project([report(1, `Created \`${name}\`.`)])).map((row) => row.path)).toEqual([fs.realpathSync(target)]);
  });
  it("derives an image ID when the original file artifact cannot serve image bytes", async () => {
    const target = file("result.png");
    const candidate = { ...report(1, ""), kind: "file" as const, path: target, metadata: { turnId: 1, path: target } };
    const [output] = outputs(await project([candidate, report(2, "![Result](result.png)")]));
    expect(output.id).toBeLessThan(0);
    expect(output.kind).toBe("image");
  });
  it.each(["pptx", "docx", "pdf", "md"])("delivers registered %s outputs without a final file link", async (ext) => {
    const target = file(`report.${ext}`);
    const candidate = { ...report(1, ""), kind: "document" as const, path: target,
      metadata: { turnId: 1, path: target, outputRole: "deliverable" } };
    const selected = outputs(await project([candidate, report(2, "Your file is ready.")]));
    expect(selected.map((row) => row.path)).toEqual([fs.realpathSync(target)]);
    expect(outputs(await project([candidate])).map((row) => row.path)).toEqual([fs.realpathSync(target)]);
    expect(outputs(await project([candidate], [turn(1, "active")], false))).toEqual([]);
  });
  it("does not deliver working files or previews and honors reclassification", async () => {
    const target = file("preview.pdf");
    const candidate = (id: number, outputRole: string) => ({ ...report(id, ""), kind: "document" as const,
      path: target, metadata: { turnId: 1, path: target, outputRole } });
    expect(outputs(await project([candidate(1, "deliverable"), candidate(2, "preview"), report(3, "Ready.")]))).toEqual([]);
    expect(outputs(await project([candidate(1, "working"), report(2, "Ready.")]))).toEqual([]);
  });
  it("resolves a bare filename only from an unambiguous artifact of the same turn", async () => {
    const target = file("outputs/report.pptx");
    const candidate = { ...report(1, ""), kind: "document" as const, path: target, metadata: { turnId: 1, path: target } };
    expect(outputs(await project([candidate, report(2, "[Deck](report.pptx)")])).map((row) => row.path))
      .toEqual([fs.realpathSync(target)]);
    const other = file("drafts/report.pptx");
    expect(outputs(await project([candidate, { ...candidate, id: 2, path: other }, report(3, "[Deck](report.pptx)")]))).toEqual([]);
    expect(outputs(await project([candidate, report(2, "Ready.", 1), report(3, "[Deck](report.pptx)", 2)], [turn(1), turn(2)]))).toEqual([]);
  });
  it.each(["agent_message", "assistant", "result.message"])("uses confirmed final evidence despite later commentary (%s)", async (source) => {
    ["progress.md", "final.md", "CONTEXT.md"].forEach(file);
    const artifacts = [report(1, "progress.md"), report(2, "final.md", 1, { source, messagePhase: "final_answer" }),
      report(3, "CONTEXT.md", 1, { messagePhase: "commentary" })];
    const result = outputs(await project(artifacts));
    expect(result.map((row) => row.metadata?.fileName)).toEqual(["final.md"]);
    expect(result[0].metadata?.outputAnchor).toEqual({ source: "artifact", id: 2 });
  });
  it.each([undefined, "commentary", "unknown"])("falls back to only the last logical message without final evidence (%s)", async (phase) => {
    ["early.md", "penultimate.md", "last.md"].forEach(file);
    expect(outputs(await project([report(1, "early.md"), report(2, "penultimate.md"),
      report(3, "last.md", 1, { messagePhase: phase })])).map((row) => row.metadata?.fileName)).toEqual(["last.md"]);
  });
  it("does not fall back to an earlier file reference when the last message delivers no file", async () => {
    file("CONTEXT.md");
    expect(outputs(await project([report(1, "CONTEXT.md"), report(2, "Review now refreshes the diff.")]))).toEqual([]);
  });
  it("does not blacklist a project filename explicitly delivered in the final answer", async () => {
    file("CONTEXT.md");
    expect(outputs(await project([report(1, "[Requested document](CONTEXT.md)", 1, { messagePhase: "final_answer" })]))
      .map((row) => row.metadata?.fileName)).toEqual(["CONTEXT.md"]);
  });
  it.each(["providerMessageId", "itemId", "streamId"])("retains all parts of the selected logical message (%s)", async (key) => {
    ["early.md", "part-one.md", "part-two.md", "child.md"].forEach(file);
    const artifacts = [report(1, "early.md"), report(2, "part-one.md", 1, { [key]: "reply", messagePhase: "final_answer" }),
      report(3, "part-two.md", 1, { [key]: "reply" }),
      report(4, "child.md", 1, { isFromSubagent: true, messagePhase: "final_answer" }),
      report(5, "child.md", 1, { kind: "thinking" }), report(6, "child.md", 1, { voice: true })];
    expect(outputs(await project(artifacts)).map((row) => row.metadata?.fileName).sort()).toEqual(["part-one.md", "part-two.md"]);
  });
  it("keeps every explicitly marked final block without collecting later commentary", async () => {
    ["first.md", "second.md", "late.md"].forEach(file);
    expect(outputs(await project([report(1, "first.md", 1, { messagePhase: "final_answer" }),
      report(2, "second.md", 1, { messagePhase: "final_answer" }), report(3, "late.md")]))
      .map((row) => row.metadata?.fileName)).toEqual(["first.md", "second.md"]);
  });
  it("retains multipart messages when falling back without final evidence", async () => {
    ["early.md", "part-one.md", "part-two.md"].forEach(file);
    expect(outputs(await project([report(1, "early.md"),
      report(2, "part-one.md", 1, { providerMessageId: "last" }),
      report(3, "part-two.md", 1, { providerMessageId: "last" })])).map((row) => row.metadata?.fileName))
      .toEqual(["part-one.md", "part-two.md"]);
  });
  it("does not deliver registered documents or scanned images without a final reference", async () => {
    const context = file("CONTEXT.md");
    const image = file("generated.png");
    const artifacts = [
      { ...report(1, ""), kind: "document" as const, path: context, metadata: { path: context } },
      { ...report(2, ""), kind: "image" as const, path: image, metadata: { path: image } },
      report(3, "Done", 1, { messagePhase: "final_answer" }),
    ];
    expect(outputs(await project(artifacts))).toEqual([]);
  });
  it("delivers a native generated image when the final answer contains no file reference", async () => {
    const image = file("generated.png");
    const artifacts = [
      report(1, "Creating the mosaic", 1, { messagePhase: "commentary" }),
      { ...report(2, ""), kind: "image" as const, path: image,
        metadata: { turnId: 1, path: image, source: "codex_image_generation", transparentBackground: false } },
      report(3, "Created your ceramic mosaic mural in 16:9.", 1, { messagePhase: "final_answer" }),
    ];
    const result = outputs(await project(artifacts));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 2, kind: "image", path: fs.realpathSync(image),
      metadata: { outputTurn: "turn:1", outputAnchor: { source: "artifact", id: 3 },
        source: "codex_image_generation", transparentBackground: false } });
  });
  it("keeps native generation scoped to its completed turn during follow-ups", async () => {
    const image = file("first.png");
    const pending = file("pending.png");
    const artifacts = [
      { ...report(1, ""), kind: "image" as const, path: image,
        metadata: { turnId: 1, path: image, source: "codex_image_generation" } },
      report(2, "Created your image", 1),
      report(3, "Here is some advice", 2),
      { ...report(4, "", 3), kind: "image" as const, path: pending,
        metadata: { turnId: 3, path: pending, source: "codex_image_generation" } },
      report(5, "Working on the next image", 3),
    ];
    const result = outputs(await project(artifacts, [turn(1), turn(2), turn(3, "active")], false));
    expect(result.map((row) => row.path)).toEqual([fs.realpathSync(image)]);
    expect(result[0].metadata?.outputTurn).toBe("turn:1");
  });
  it.each(["report.md", "copy.png"])("prefers explicitly delivered files over native working images (%s)", async (name) => {
    const image = file("generated.png");
    const delivered = file(name);
    const artifacts = [
      { ...report(1, ""), kind: "image" as const, path: image,
        metadata: { turnId: 1, path: image, source: "codex_image_generation" } },
      report(2, `[Result](${name})`, 1, { messagePhase: "final_answer" }),
    ];
    expect(outputs(await project(artifacts)).map((row) => row.path)).toEqual([fs.realpathSync(delivered)]);
  });
  it("deduplicates canonical paths and keeps stable IDs when a file is delivered again", async () => {
    const target = file("My report.md");
    const candidate = { ...report(1, ""), kind: "document" as const, path: target, metadata: { path: target } };
    const artifacts = [candidate, report(2, `[Report](<${target}>) [Again](My%20report.md) ./My%20report.md`)];
    const result = outputs(await project(artifacts));
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(fs.realpathSync(target));
    expect(outputs(await project([...artifacts, report(3, `[Delivered](<${target}>)`)]))[0].id).toBe(result[0].id);
  });
  it("retains each completed turn's final outputs while a follow-up is still running", async () => {
    ["first.md", "second.md", "unfinished.md"].forEach(file);
    const artifacts = [report(1, "first.md", 1), report(2, "second.md", 2), report(3, "unfinished.md", 3)];
    expect(outputs(await project(artifacts, [turn(1), turn(2), turn(3, "active")], false)).map((row) => row.metadata?.fileName))
      .toEqual(["first.md", "second.md"]);
  });
  it("keeps an earlier turn's image identity when a follow-up delivers the same path", async () => {
    const target = file("image.png");
    const image = (id: number, turnId: number) => ({ ...report(id, "", turnId), kind: "image" as const, path: target,
      metadata: { turnId, path: target } });
    const first = [image(1, 1), report(2, "![Result](image.png)", 1)];
    const before = outputs(await project(first));
    const after = outputs(await project([...first, image(3, 2), report(4, "![Updated](image.png)", 2)], [turn(1), turn(2)]));
    expect(after.map((row) => row.id)).toEqual([before[0].id, 3]);
  });
  it("uses prompt boundaries for legacy history and does not split on steering", async () => {
    ["first.md", "second.md", "early.md"].forEach(file);
    const prompt = (id: number, delivery?: string) => ({ ...report(id, "prompt"), kind: "user-prompt" as "report", metadata: { delivery } });
    const legacy = (id: number, content: string) => ({ ...report(id, content), metadata: null });
    const artifacts = [prompt(1), legacy(2, "first.md"), prompt(3), legacy(4, "early.md"), prompt(5, "steer"), legacy(6, "second.md")];
    expect(outputs(await project(artifacts, [])).map((row) => row.metadata?.fileName)).toEqual(["first.md", "second.md"]);
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
    "keeps final Markdown images in the common output set without a second image card: %s", async (markdown) => {
    const target = file("image.png");
    const image = { ...report(1, ""), kind: "image" as const, path: target, metadata: { path: target } };
    const result = outputs(await project([image, report(2, markdown, 1, { messagePhase: "final_answer" })]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(image.id);
    expect(result[0].metadata?.inlineInReport).toBe(true);
  });
});
