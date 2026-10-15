import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OUTPUT_FILE_MAX_BYTES, OUTPUT_DOCUMENT_TYPES as DOCUMENT_TYPES, OUTPUT_IMAGE_EXTENSIONS as IMAGE_EXTENSIONS } from "@mains/contracts/output-files";
import { outputReferences, resolveOutputFilePath as resolveReference } from "./run-output-references";
import type { RunArtifactResponse } from "./runs.dto";
import type { RunTurnResponse } from "@mains/contracts/runs";

interface History {
  artifacts: RunArtifactResponse[];
  turns: RunTurnResponse[];
  terminal: boolean;
}
interface Reply {
  key: string;
  messages: RunArtifactResponse[][];
  candidates: RunArtifactResponse[];
}
const FILE_KINDS = new Set(["file", "document", "image"]);
const parent = (metadata: Record<string, unknown> | null) => !metadata?.isFromSubagent && !metadata?.voice;
const time = (value: Date | null) => value ? new Date(value).getTime() : 0;
const chronological = (a: { id: number; createdAt: Date }, b: { id: number; createdAt: Date }) =>
  time(a.createdAt) - time(b.createdAt) || a.id - b.id;
const isMessage = (row: RunArtifactResponse) => row.kind === "report" && !!row.content?.trim() && parent(row.metadata) &&
  (!row.metadata?.kind || row.metadata.kind === "report") &&
  !["codex_plan", "codex_plan_streaming", "agent_thinking_streaming"].includes(String(row.metadata?.source));

/** Confirmed final replies, falling back to the last logical message, per completed turn. */
export function deliverableReplies(history: History): Reply[] {
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
  const keyFor = (row: RunArtifactResponse) => {
    if (typeof row.metadata?.turnId === "number") return `turn:${row.metadata.turnId}`;
    const boundary = [...boundaries].reverse().find(({ row: prompt }) => time(prompt.createdAt) < time(row.createdAt) ||
      (time(prompt.createdAt) === time(row.createdAt) && prompt.id <= row.id));
    if (boundary) return boundary.key;
    const turn = [...turns].reverse().find((turn) => time(turn.startedAt) <= time(row.createdAt));
    return turn ? `turn:${turn.id}` : "legacy";
  };
  const groups = new Map<string, Map<string, RunArtifactResponse[]>>();
  const candidates = new Map<string, RunArtifactResponse[]>();
  const group = (key: string) => {
    let result = groups.get(key);
    if (!result) { result = new Map(); groups.set(key, result); }
    return result;
  };
  for (const row of [...history.artifacts].sort(chronological)) {
    if (FILE_KINDS.has(row.kind) && parent(row.metadata)) {
      const key = keyFor(row);
      const rows = candidates.get(key) ?? [];
      rows.push(row);
      candidates.set(key, rows);
      if (row.metadata?.outputRole === "deliverable" || row.metadata?.source === "codex_image_generation") group(key);
    }
    if (!isMessage(row)) continue;
    const messages = group(keyFor(row));
    const nativeId = row.metadata?.providerMessageId ?? row.metadata?.itemId ?? row.metadata?.streamId;
    const messageKey = typeof nativeId === "string" ? nativeId : `row:${row.id}`;
    const parts = messages.get(messageKey) ?? [];
    parts.push(row);
    // A provider may persist several parts of one final reply.
    messages.set(messageKey, parts);
  }
  return [...groups].filter(([key]) => completed.has(key)).map(([key, group]) => {
    const messages = [...group.values()];
    const final = messages.filter((parts) => parts.some((row) => row.metadata?.messagePhase === "final_answer"));
    return { key, messages: final.length ? final : messages.slice(-1), candidates: candidates.get(key) ?? [] };
  });
}
function within(root: string, file: string) {
  const relative = path.relative(root, file);
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** One read-only output projection for chat, Atlas and the session shelf.
 * Explicit reply references take priority; native generation can deliver its
 * own images when that reply names no files. Other candidates are not outputs.
 * Negative IDs identify derived rows; the persisted event ledger stays intact.
 */
export async function projectRunDeliverables(input: History & {
  runId: string; root: string | null; extraRoots?: string[];
}): Promise<RunArtifactResponse[]> {
  const rootPaths = [...(input.root ? [input.root] : []), ...(input.extraRoots ?? [])];
  const roots = await Promise.all(rootPaths.map((root) => fs.realpath(root).catch(() => null)));
  const result = input.artifacts.filter((row) => !FILE_KINDS.has(row.kind));
  const usedArtifactIds = new Set<number>();
  const inspected = new Map<string, Promise<{ real: string; size: number; modifiedAt: number } | null>>();
  const inspect = (file: string) => {
    let value = inspected.get(file);
    if (!value) {
      value = (async () => {
        try {
          const stats = await fs.lstat(file);
          if (!stats.isFile() || stats.isSymbolicLink() || stats.size > OUTPUT_FILE_MAX_BYTES) return null;
          const real = await fs.realpath(file);
          return roots.some((root) => root && within(root, real)) ? { real, size: stats.size, modifiedAt: stats.mtimeMs } : null;
        } catch { return null; }
      })();
      inspected.set(file, value);
    }
    return value;
  };
  const fileRows = new Map<string, RunArtifactResponse[]>();
  const addFileRow = (file: string, row: RunArtifactResponse) => {
    const rows = fileRows.get(file) ?? [];
    if (rows.at(-1)?.id !== row.id) rows.push(row);
    fileRows.set(file, rows);
  };
  for (const row of input.artifacts) {
    if (!FILE_KINDS.has(row.kind)) continue;
    const reference = row.path ?? row.metadata?.path;
    const resolved = typeof reference === "string" && resolveReference(reference, input.root);
    if (!resolved) continue;
    addFileRow(resolved, row);
    // Resolve aliases of the roots once; don't inspect earlier image files
    // merely to recover their persisted ID. Only delivered files are read.
    rootPaths.forEach((root, index) => {
      if (roots[index] && within(root, resolved))
        addFileRow(path.resolve(roots[index]!, path.relative(root, resolved)), row);
    });
  }
  for (const reply of deliverableReplies(input)) {
    const messages = reply.messages.flat();
    const paths = new Set<string>();
    const embedded = new Set<string>();
    const add = (file: string) => { if (paths.size < 500) paths.add(file); };
    for (const parts of reply.messages) {
      const text = parts.map((row) => row.content ?? "").join("\n");
      const references = outputReferences(text, input.root);
      references.files.forEach(add);
      references.embedded.forEach((file) => embedded.add(file));
    }
    // Native image generation displays its result independently of Markdown.
    // A final file reference instead selects the saved copy or composed document.
    const declared = new Map<string, RunArtifactResponse>();
    for (const row of reply.candidates) {
      const reference = row.path ?? row.metadata?.path;
      const resolved = typeof reference === "string" && resolveReference(reference, input.root);
      if (resolved && (row.metadata?.outputRole || row.metadata?.source === "codex_image_generation")) declared.set(resolved, row);
    }
    const delivered = [...declared].filter(([, row]) => row.metadata?.outputRole === "deliverable" ||
      (!row.metadata?.outputRole && row.metadata?.source === "codex_image_generation"));
    if (paths.size === 0) delivered.forEach(([file]) => add(file));
    const anchor = messages.at(-1) ?? delivered.at(-1)?.[1];
    if (!anchor) continue;
    const seen = new Set<string>();
    const realEmbedded = new Set((await Promise.all([...embedded].map(inspect))).flatMap((file) => file ? [file.real] : []));
    for (const file of paths) {
      let inspectedFile = await inspect(file);
      if (!inspectedFile) {
        const matches = new Map<string, NonNullable<Awaited<ReturnType<typeof inspect>>>>();
        for (const row of reply.candidates) {
          const reference = row.path ?? row.metadata?.path;
          const candidate = typeof reference === "string" && resolveReference(reference, input.root);
          if (!candidate || path.basename(candidate) !== path.basename(file)) continue;
          const checked = await inspect(candidate);
          if (checked) matches.set(checked.real, checked);
        }
        if (matches.size === 1) inspectedFile = [...matches.values()][0];
      }
      if (!inspectedFile || seen.has(inspectedFile.real)) continue;
      seen.add(inspectedFile.real);
      const real = inspectedFile.real;
      const extension = path.extname(real).slice(1).toLowerCase();
      const image = IMAGE_EXTENSIONS.has(extension);
      // Preserve existing image IDs so older paired clients can still request
      // their pixels. New files and repeated delivery in another turn derive IDs.
      const existingFile = declared.get(real) ?? [...(fileRows.get(real) ?? [])].reverse().find((row) => {
        if (typeof row.metadata?.turnId === "number") return reply.key === `turn:${row.metadata.turnId}`;
        return time(row.createdAt) < time(anchor.createdAt) || (time(row.createdAt) === time(anchor.createdAt) &&
          row.id <= anchor.id);
      });
      const id = existingFile && existingFile.kind === (image ? "image" : "document") && !usedArtifactIds.has(existingFile.id) ? existingFile.id
        : -parseInt(createHash("sha256").update(JSON.stringify([input.runId, reply.key, real])).digest("hex").slice(0, 13), 16) - 1;
      if (existingFile) usedArtifactIds.add(existingFile.id);
      result.push({ id, runId: input.runId, kind: image ? "image" : "document", path: real, content: "",
        blobData: null, entityId: null, contentHash: null,
        createdAt: anchor.createdAt, metadata: {
          ...(existingFile?.metadata ?? {}),
          kind: image ? "image" : "document", outputSelected: true,
          outputTurn: reply.key, outputAnchor: { source: "artifact", id: anchor.id }, path: real,
          fileName: path.basename(real), docType: DOCUMENT_TYPES[extension], byteSize: inspectedFile.size,
          modifiedAt: inspectedFile.modifiedAt, ...(image && realEmbedded.has(real) ? { inlineInReport: true } : {}) } });
    }
  }
  return result;
}
