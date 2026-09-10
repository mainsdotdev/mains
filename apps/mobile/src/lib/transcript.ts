import type { RunArtifactRow, ToolCallRow } from "@/db/schema";

import { promptFileFromPath, type PromptFile, type PromptSkill } from "./prompt-chips";

/**
 * The phone's transcript layout — a port of the rules in the desktop's
 * `group-events.ts`: artifacts and tool calls interleaved by time, each
 * artifact classified by its `kind`, and a run of consecutive tool calls folded
 * into one block.
 *
 *  - "user-prompt"            → a prompt bubble
 *  - "thinking", subagent     → hidden (UI-only on desktop too)
 *  - "prompt_suggestion"      → hidden (no composer on the phone yet)
 *  - "image"                  → an image; the pixels are fetched on demand
 *  - kind "log" artifacts     → hidden unless they are errors
 *  - anything else            → an assistant message
 *
 * The fold is the phone's own call. The desktop can afford to list thirty tool
 * rows under a turn; here a stretch of them becomes a single "Worked for 24s"
 * line that opens, so scrolling a transcript means scrolling what was *said*.
 * Consecutive images fold the same way, into one gallery — as the desktop's
 * `groupEvents` merges them.
 */
export type TranscriptItem =
  | {
      key: string;
      kind: "prompt";
      text: string;
      at: number;
      /** Structured context the prompt carried — what its chips are drawn from. */
      skills: PromptSkill[];
      files: PromptFile[];
      /** Image attachments shown above the user's text bubble. */
      images: PromptImage[];
    }
  | { key: string; kind: "response"; text: string; at: number }
  | { key: string; kind: "tools"; calls: ToolCallRow[]; at: number }
  | { key: string; kind: "images"; images: TranscriptImage[]; at: number }
  | { key: string; kind: "note"; text: string; at: number };

/** One image an agent produced. The Mac holds the file; the phone asks for pixels by id. */
export interface TranscriptImage {
  artifactId: number;
  fileName: string;
}

/** One image the user attached to a prompt, already reachable on this phone. */
export interface PromptImage {
  key: string;
  name: string;
  uri: string;
  /** Presentation-only crop used by the camera's simulator fallback. */
  previewCropBottom?: number;
}

/** Pre-fold shape: one entry per tool call or image, before consecutive ones merge. */
type FlatItem =
  | Exclude<TranscriptItem, { kind: "tools" } | { kind: "images" }>
  | { key: string; kind: "tool"; call: ToolCallRow; at: number }
  | { key: string; kind: "image"; image: TranscriptImage; at: number };

interface ArtifactMetadata {
  level?: unknown;
  isFromSubagent?: unknown;
  /** Present on a user prompt: the skills and files the composer attached. */
  skills?: unknown;
  files?: unknown;
  attachments?: unknown;
  /** Present on an image: the file's own name, for a caption. */
  fileName?: unknown;
}

function metadataOf(artifact: RunArtifactRow): ArtifactMetadata {
  if (!artifact.metadataJson) return {};
  try {
    const parsed: unknown = JSON.parse(artifact.metadataJson);
    return parsed && typeof parsed === "object" ? (parsed as ArtifactMetadata) : {};
  } catch {
    return {};
  }
}

function artifactItem(artifact: RunArtifactRow): FlatItem | null {
  const meta = metadataOf(artifact);
  const at = artifact.createdAt.getTime();
  const key = `artifact-${artifact.id}`;

  if (meta.isFromSubagent) return null;

  // The `kind` *column* is the discriminator, not anything inside the metadata
  // blob. The desktop reads `metadata.kind` only because its event mapper
  // stamps `{ ...parseMetadata(row.metadata), kind: row.kind }` on the way out
  // — the column always wins there. The adapter writes the prompt as
  // `kind: "user-prompt"` with `metadata: { source: "user" }`, so keying off
  // the metadata here filed every prompt under "assistant message".
  switch (artifact.kind) {
    case "log": {
      const level = typeof meta.level === "string" ? meta.level : "";
      if (level !== "error" || !artifact.content) return null;
      return { key, kind: "note", text: artifact.content, at };
    }
    case "thinking":
    case "prompt_suggestion":
      return null;
    case "user-prompt": {
      const images = promptImages(meta);
      return artifact.content || images.length > 0
        ? {
            key,
            kind: "prompt",
            text: artifact.content ?? "",
            at,
            skills: promptSkills(meta),
            files: promptFiles(meta),
            images,
          }
        : null;
    }
    case "image": {
      const fileName =
        typeof meta.fileName === "string" && meta.fileName
          ? meta.fileName
          : (artifact.path?.split("/").pop() ?? "image");
      return { key, kind: "image", image: { artifactId: artifact.id, fileName }, at };
    }
    default: {
      const text = artifact.content ?? artifact.path ?? "";
      return text ? { key, kind: "response", text, at } : null;
    }
  }
}

/** `metadata.skills` — the composer's own records, passed through unchanged. */
function promptSkills(meta: ArtifactMetadata): PromptSkill[] {
  if (!Array.isArray(meta.skills)) return [];
  return meta.skills.filter(
    (s): s is PromptSkill =>
      Boolean(s) && typeof s === "object" && typeof (s as PromptSkill).name === "string",
  );
}

/** `metadata.files` — `{ path }` records; the chip needs the basename too. */
function promptFiles(meta: ArtifactMetadata): PromptFile[] {
  if (!Array.isArray(meta.files)) return [];
  const out: PromptFile[] = [];
  for (const entry of meta.files) {
    if (!entry || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path === "string" && path) out.push(promptFileFromPath(path));
  }
  return out;
}

/** Phone uploads return through prompt metadata as safe, self-contained data URLs. */
function promptImages(meta: ArtifactMetadata): PromptImage[] {
  if (!Array.isArray(meta.attachments)) return [];
  const out: PromptImage[] = [];
  for (const [index, entry] of meta.attachments.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const attachment = entry as {
      name?: unknown;
      type?: unknown;
      dataUrl?: unknown;
    };
    if (
      attachment.type !== "image" ||
      typeof attachment.dataUrl !== "string" ||
      !attachment.dataUrl.startsWith("data:image/")
    ) {
      continue;
    }
    const name =
      typeof attachment.name === "string" && attachment.name
        ? attachment.name
        : `image-${index + 1}`;
    out.push({
      key: `prompt-image:${index}:${name}`,
      name,
      uri: attachment.dataUrl,
    });
  }
  return out;
}

export function buildTranscript(
  artifacts: RunArtifactRow[],
  calls: ToolCallRow[],
): TranscriptItem[] {
  const flat: FlatItem[] = [];
  for (const artifact of artifacts) {
    const item = artifactItem(artifact);
    if (item) flat.push(item);
  }
  for (const call of calls) {
    flat.push({ key: `tool-${call.id}`, kind: "tool", call, at: call.createdAt.getTime() });
  }

  // Same tie-break as the desktop: on equal timestamps artifacts come before
  // tool calls, then by source-row id.
  flat.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    const rank = (i: FlatItem) => (i.kind === "tool" ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return numericId(a.key) - numericId(b.key);
  });

  return foldRuns(flat);
}

/**
 * Consecutive tool calls become one block and consecutive images one gallery,
 * each keyed by the first of its kind in it.
 */
function foldRuns(flat: FlatItem[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let tools: { key: string; kind: "tools"; calls: ToolCallRow[]; at: number } | null = null;
  let images: { key: string; kind: "images"; images: TranscriptImage[]; at: number } | null = null;

  for (const item of flat) {
    if (item.kind === "tool") {
      images = null;
      if (tools) {
        tools.calls.push(item.call);
      } else {
        tools = { key: `tools-${item.call.id}`, kind: "tools", calls: [item.call], at: item.at };
        items.push(tools);
      }
      continue;
    }
    if (item.kind === "image") {
      tools = null;
      if (images) {
        images.images.push(item.image);
      } else {
        images = { key: `images-${item.image.artifactId}`, kind: "images", images: [item.image], at: item.at };
        items.push(images);
      }
      continue;
    }
    tools = null;
    images = null;
    items.push(item);
  }

  return items;
}

function numericId(key: string): number {
  const dash = key.lastIndexOf("-");
  const n = dash >= 0 ? Number(key.slice(dash + 1)) : NaN;
  return Number.isFinite(n) ? n : 0;
}
