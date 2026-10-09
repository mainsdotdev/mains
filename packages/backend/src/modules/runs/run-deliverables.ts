import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunArtifactResponse } from "./runs.dto";
import type { RunTurnResponse, ToolCallResponse } from "@mains/contracts/runs";

interface History {
  artifacts: RunArtifactResponse[];
  toolCalls: ToolCallResponse[];
  turns: RunTurnResponse[];
  terminal: boolean;
}
interface Tail {
  key: string;
  messages: RunArtifactResponse[][];
  calls: ToolCallResponse[];
}
const FILE_KINDS = new Set(["file", "document", "image"]);
const DOCUMENT_TYPES: Record<string, string> = { md: "md", markdown: "md", txt: "txt", csv: "txt",
  pdf: "pdf", docx: "docx", pptx: "pptx", xlsx: "xlsx" };
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
const EXTENSIONS = "pptx|docx|xlsx|pdf|markdown|md|txt|csv|png|jpe?g|gif|webp|avif|svg";
const parent = (metadata: Record<string, unknown> | null) => !metadata?.isFromSubagent && !metadata?.voice;
const time = (value: Date | null) => value ? new Date(value).getTime() : 0;
const chronological = (a: { id: number; createdAt: Date }, b: { id: number; createdAt: Date }) =>
  time(a.createdAt) - time(b.createdAt) || a.id - b.id;
const isMessage = (row: RunArtifactResponse) => row.kind === "report" && !!row.content?.trim() && parent(row.metadata) &&
  (!row.metadata?.kind || row.metadata.kind === "report") &&
  !["codex_plan", "codex_plan_streaming", "agent_thinking_streaming"].includes(String(row.metadata?.source));

/** Logical messages (including multipart provider records) and calls, per actual turn. */
export function deliverableTails(history: History): Tail[] {
  const turns = [...history.turns].sort((a, b) => a.turnIndex - b.turnIndex);
  const prompts = history.artifacts.filter((row) => String(row.kind) === "user-prompt" &&
    row.metadata?.delivery !== "steer" && parent(row.metadata)).sort(chronological);
  const boundaries = prompts.map((row, index) => {
    const turn = turns.length === prompts.length ? turns[index] : turns.find((turn) =>
      turn.promptContent === row.content && Math.abs(time(turn.startedAt) - time(row.createdAt)) <= 1000);
    return { row, key: turn ? `turn:${turn.id}` : `prompt:${row.id}`, complete: turn
      ? turn.status === "completed" : index < prompts.length - 1 || history.terminal };
  });
  const completed = new Set(turns.filter((turn) => turn.status === "completed").map((turn) => `turn:${turn.id}`));
  boundaries.filter((boundary) => boundary.complete).forEach((boundary) => completed.add(boundary.key));
  if (!turns.length && !prompts.length && history.terminal) completed.add("legacy");
  const keyFor = (row: { id: number; createdAt: Date; metadata: Record<string, unknown> | null }, tool: boolean) => {
    if (typeof row.metadata?.turnId === "number") return `turn:${row.metadata.turnId}`;
    const boundary = [...boundaries].reverse().find(({ row: prompt }) => time(prompt.createdAt) < time(row.createdAt) ||
      (time(prompt.createdAt) === time(row.createdAt) && (tool || prompt.id <= row.id)));
    if (boundary) return boundary.key;
    const turn = [...turns].reverse().find((turn) => time(turn.startedAt) <= time(row.createdAt));
    return turn ? `turn:${turn.id}` : "legacy";
  };
  const groups = new Map<string, { messages: Map<string, RunArtifactResponse[]>; calls: Map<string, ToolCallResponse> }>();
  const group = (key: string) => {
    let result = groups.get(key);
    if (!result) { result = { messages: new Map(), calls: new Map() }; groups.set(key, result); }
    return result;
  };
  for (const row of [...history.artifacts].sort(chronological)) {
    if (!isMessage(row)) continue;
    const messages = group(keyFor(row, false)).messages;
    const nativeId = row.metadata?.providerMessageId ?? row.metadata?.itemId ?? row.metadata?.streamId;
    const messageKey = typeof nativeId === "string" ? nativeId : `row:${row.id}`;
    const parts = messages.get(messageKey) ?? [];
    parts.push(row);
    // Updated parts belong to the same message, not to another last-two slot.
    messages.set(messageKey, parts);
  }
  // Codex's native image-generation item is a logical tool call even though
  // its adapter persists the result as image artifacts rather than tool rows.
  const native = new Map<string, ToolCallResponse>();
  for (const row of history.artifacts) {
    if (row.kind !== "image" || row.metadata?.source !== "codex_image_generation" || !parent(row.metadata)) continue;
    const itemId = String(row.metadata.itemId ?? row.id);
    const key = `${keyFor(row, false)}:${itemId}`;
    const previous = native.get(key);
    const file = row.metadata.path ?? row.path;
    if (previous) { (previous.output as unknown[]).push(file); continue; }
    if (history.toolCalls.some((call) => call.toolId === itemId && keyFor(call, true) === keyFor(row, false))) continue;
    native.set(key, { id: -row.id, runId: row.runId, toolId: itemId, parentToolCallId: null,
      toolName: "image_generation", status: "done", input: null, output: [file], error: null,
      startedAt: row.createdAt, endedAt: row.createdAt, createdAt: row.createdAt, updatedAt: row.createdAt, metadata: row.metadata });
  }
  for (const row of [...history.toolCalls, ...native.values()].sort(chronological)) {
    if (row.parentToolCallId || !parent(row.metadata) || row.metadata?.parentToolUseId) continue;
    group(keyFor(row, true)).calls.set(row.toolId || `row:${row.id}`, row);
  }
  return [...groups].filter(([key]) => completed.has(key)).map(([key, group]) => ({ key,
    messages: [...group.messages.values()].slice(-2), calls: [...group.calls.values()].slice(-2) }));
}

function strings(value: unknown): string[] {
  const result: string[] = [];
  let remaining = 2_000_000;
  const visit = (next: unknown, depth: number) => {
    if (depth > 8 || result.length >= 1000 || remaining <= 0) return;
    if (typeof next === "string") { const text = next.slice(0, Math.min(remaining, 1_000_000)); result.push(text); remaining -= text.length; }
    else if (Array.isArray(next)) next.forEach((child) => visit(child, depth + 1));
    else if (next && typeof next === "object") Object.values(next).forEach((child) => visit(child, depth + 1));
  };
  visit(value, 0);
  return result;
}
function resolveReference(reference: string, root: string | null): string | null {
  let value = reference.trim().replace(/^<|>$/g, "");
  try { value = decodeURIComponent(value); } catch { /* Literal percent in a filename. */ }
  if (/^[a-z][\w+.-]*:/i.test(value) && !value.startsWith("file:")) return null;
  if (value.startsWith("file:")) {
    try { const url = new URL(value); if (url.hostname && url.hostname !== "localhost") return null; value = url.pathname; }
    catch { return null; }
  }
  value = value.replace(/(?:#L\d+(?:-\d+)?|:\d+(?::\d+)?)$/, "");
  if (value.startsWith("~/")) value = path.join(os.homedir(), value.slice(2));
  if (value.includes("\0") || value.length > 4096) return null;
  return path.isAbsolute(value) ? path.resolve(value) : root ? path.resolve(root, value) : null;
}
function references(text: string, root: string | null): Set<string> {
  const result = new Set<string>();
  const add = (reference: string) => {
    if (result.size >= 500 || reference.length > 4096) return;
    const file = resolveReference(reference, root);
    if (file && (DOCUMENT_TYPES[path.extname(file).slice(1).toLowerCase()] || IMAGE_EXTENSIONS.has(path.extname(file).slice(1).toLowerCase()))) result.add(file);
  };
  // Markdown destinations and quoted paths preserve spaces; bare tokens cover
  // shell output and structured path fields. Remote URLs never become local paths.
  for (const match of text.matchAll(/\]\(\s*(<[^>]+>|[^\n)]+)\)/g)) add(match[1].replace(/\s+["'][^"']*["']$/, ""));
  for (const match of text.matchAll(/[`"']([^`"'\n]+)[`"']/g)) add(match[1]);
  for (const match of text.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm)) add(match[1]);
  const withoutUrls = text.replace(/(?:https?:\/\/|[a-z][\w+.-]*:\/\/)[^\s<>"'`]+/gi, "");
  const extension = new RegExp(`\\.(?:${EXTENSIONS})(?:#L\\d+(?:-\\d+)?|:\\d+(?::\\d+)?)?$`, "i");
  for (const match of withoutUrls.matchAll(/[^\s`"'<>()[\]{}=,;]+/g)) {
    const token = match[0].replace(/[.,;!?]+$/, "");
    if (token.length <= 4096 && extension.test(token)) add(token);
  }
  // A path field is often the whole string, including whitespace in its name.
  if (!text.includes("\n") && new RegExp(`\\.(?:${EXTENSIONS})$`, "i").test(text.trim())) add(text);
  return result;
}
function inlineImages(text: string, root: string | null) {
  const result = new Set<string>();
  for (const match of text.matchAll(/!\[[^\]]*\]\(\s*(<[^>]+>|[^\n)]+)\)/g)) {
    const file = resolveReference(match[1].replace(/\s+["'][^"']*["']$/, ""), root); if (file) result.add(file);
  }
  const definitions = new Map<string, string>();
  for (const match of text.matchAll(/^\s*\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)) definitions.set(match[1].toLowerCase(), match[2]);
  for (const match of text.matchAll(/!\[([^\]]*)\](?:\[([^\]]*)\])?/g)) {
    const ref = definitions.get((match[2] || match[1]).toLowerCase());
    const file = ref && resolveReference(ref, root); if (file) result.add(file);
  }
  return result;
}
function within(root: string, file: string) {
  const relative = path.relative(root, file);
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** One read-only output projection for chat, Atlas and the session shelf.
 * Candidate artifacts and directory contents are not evidence of delivery.
 * Negative IDs identify derived rows; the persisted event ledger stays intact.
 */
export async function projectRunDeliverables(input: History & {
  runId: string; root: string | null; extraRoots?: string[];
}): Promise<RunArtifactResponse[]> {
  const rootPaths = [...(input.root ? [input.root] : []), ...(input.extraRoots ?? [])];
  const roots = await Promise.all(rootPaths.map((root) => fs.realpath(root).catch(() => null)));
  const result = input.artifacts.filter((row) => !FILE_KINDS.has(row.kind));
  const usedImageIds = new Set<number>();
  const inspected = new Map<string, Promise<{ real: string; size: number; modifiedAt: number } | null>>();
  const inspect = (file: string) => {
    let value = inspected.get(file);
    if (!value) {
      value = (async () => {
        try {
          const stats = await fs.lstat(file);
          if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 100 * 1024 * 1024) return null;
          const real = await fs.realpath(file);
          return roots.some((root) => root && within(root, real)) ? { real, size: stats.size, modifiedAt: stats.mtimeMs } : null;
        } catch { return null; }
      })();
      inspected.set(file, value);
    }
    return value;
  };
  const imageRows = new Map<string, RunArtifactResponse[]>();
  const addImageRow = (file: string, row: RunArtifactResponse) => {
    const rows = imageRows.get(file) ?? [];
    if (rows.at(-1)?.id !== row.id) rows.push(row);
    imageRows.set(file, rows);
  };
  for (const row of input.artifacts) {
    if (row.kind !== "image") continue;
    const reference = row.path ?? row.metadata?.path;
    const resolved = typeof reference === "string" && resolveReference(reference, input.root);
    if (!resolved) continue;
    addImageRow(resolved, row);
    // Resolve aliases of the roots once; don't inspect earlier image files
    // merely to recover their persisted ID. Only tail-selected files are read.
    rootPaths.forEach((root, index) => {
      if (roots[index] && within(root, resolved))
        addImageRow(path.resolve(roots[index]!, path.relative(root, resolved)), row);
    });
  }
  for (const tail of deliverableTails(input)) {
    const messages = tail.messages.flat();
    const paths = new Set<string>();
    const embedded = new Set<string>();
    const add = (file: string) => { if (paths.size < 500) paths.add(file); };
    for (const parts of tail.messages) {
      const text = parts.map((row) => row.content ?? "").join("\n");
      references(text, input.root).forEach(add);
      inlineImages(text, input.root).forEach((file) => embedded.add(file));
    }
    for (const call of tail.calls) for (const text of strings([call.input, call.output]))
      references(text, input.root).forEach(add);
    const anchor = messages.at(-1) ?? tail.calls.at(-1);
    if (!anchor) continue;
    const anchorSource = messages.length || anchor.id < 0 ? "artifact" : "tool";
    const seen = new Set<string>();
    const realEmbedded = new Set((await Promise.all([...embedded].map(inspect))).flatMap((file) => file ? [file.real] : []));
    for (const file of paths) {
      const inspectedFile = await inspect(file);
      if (!inspectedFile || seen.has(inspectedFile.real)) continue;
      seen.add(inspectedFile.real);
      const real = inspectedFile.real;
      const extension = path.extname(real).slice(1).toLowerCase();
      const image = IMAGE_EXTENSIONS.has(extension);
      // Preserve existing image IDs so older paired clients can still request
      // their pixels. New files and repeated delivery in another turn derive IDs.
      const existingImage = image ? [...(imageRows.get(real) ?? [])].reverse().find((row) => {
        if (typeof row.metadata?.turnId === "number") return tail.key === `turn:${row.metadata.turnId}`;
        return time(row.createdAt) < time(anchor.createdAt) || (time(row.createdAt) === time(anchor.createdAt) &&
          (anchorSource === "tool" || row.id <= Math.abs(anchor.id)));
      }) : undefined;
      const id = existingImage && !usedImageIds.has(existingImage.id) ? existingImage.id
        : -parseInt(createHash("sha256").update(JSON.stringify([input.runId, tail.key, real])).digest("hex").slice(0, 13), 16) - 1;
      if (existingImage) usedImageIds.add(existingImage.id);
      result.push({ id, runId: input.runId, kind: image ? "image" : "document", path: real, content: "",
        blobData: null, entityId: null, contentHash: null,
        createdAt: anchor.createdAt, metadata: { kind: image ? "image" : "document", outputSelected: true,
          outputTurn: tail.key, outputAnchor: { source: anchorSource, id: Math.abs(anchor.id) }, path: real,
          fileName: path.basename(real), docType: DOCUMENT_TYPES[extension], byteSize: inspectedFile.size,
          modifiedAt: inspectedFile.modifiedAt, ...(image && realEmbedded.has(real) ? { inlineInReport: true } : {}) } });
    }
  }
  return result;
}
