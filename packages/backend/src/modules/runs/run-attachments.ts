import * as fs from "fs";
import * as path from "path";
import type { FileAttachment } from "./runs.dto";

// ─────────────────────────────────────────────────────────────
// Run attachments cross a trust boundary: the local renderer sends them, but
// so do WebSocket clients and paired phones, through the same `runs:execute` /
// `runs:continue` / `runs:fork` handlers. The adapters write every attachment
// to `<tmp>/mains-uploads/<runId>/<name>` and read `sourcePath` straight off
// disk, so both fields are narrowed here, before a run starts:
//  - `name` is a display filename, never a path — only its last segment stays.
//  - `sourcePath` exists for main-process-owned browser/Appshot screenshots,
//    which are already written under `browser-captures`. An image path
//    that resolves anywhere else — directly or through a symlink — is refused.
// ─────────────────────────────────────────────────────────────

const ATTACHMENT_TYPES = new Set<FileAttachment["type"]>(["image", "document"]);
const FALLBACK_NAME = "attachment";

/** Strictly below `parent` — the directory itself does not count. */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** The last path segment of a client-supplied name, whichever separator it used. */
export function attachmentFileName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").replace(/\0/g, "").trim();
  return base === "" || base === "." || base === ".." ? FALLBACK_NAME : base;
}

function allowedSourcePath(raw: string, captureDir: string): string {
  const refused = new Error("Attachment source must be a trusted Mains capture");
  if (raw.includes("\0")) throw refused;
  const resolved = path.resolve(raw);
  if (!isInside(captureDir, resolved)) throw refused;

  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    // An evicted capture: nothing to escape through, and the adapter already
    // skips a source it cannot copy.
    return resolved;
  }
  let realDir = captureDir;
  try {
    realDir = fs.realpathSync(captureDir);
  } catch {
    // The directory itself is gone; `real` exists, so it cannot be inside it.
  }
  if (!isInside(realDir, real)) throw refused;
  return real;
}

/**
 * Validate a run request's attachments. Returns them with `name` reduced to a
 * filename and `sourcePath` pinned inside `captureDir`; throws on anything
 * malformed or out of bounds, so a bad request never starts a run.
 */
export function sanitizeRunAttachments(
  attachments: unknown,
  captureDir: string,
): FileAttachment[] | undefined {
  if (attachments === undefined || attachments === null) return undefined;
  if (!Array.isArray(attachments)) throw new Error("Attachments must be a list");

  return attachments.map((item): FileAttachment => {
    if (!item || typeof item !== "object") throw new Error("Invalid attachment");
    const { name, type, mimeType, data, sourcePath } = item as Record<string, unknown>;

    if (typeof name !== "string" || name.trim() === "") {
      throw new Error("Attachment name is required");
    }
    if (!ATTACHMENT_TYPES.has(type as FileAttachment["type"])) {
      throw new Error("Unsupported attachment type");
    }
    if (typeof mimeType !== "string") throw new Error("Attachment MIME type is required");
    if (data !== undefined && typeof data !== "string") {
      throw new Error("Attachment data must be base64 text");
    }

    const out: FileAttachment = {
      name: attachmentFileName(name),
      type: type as FileAttachment["type"],
      mimeType,
    };
    if (typeof data === "string") out.data = data;

    if (sourcePath !== undefined && sourcePath !== null && sourcePath !== "") {
      // Trusted captures are screenshots; a document never comes from disk.
      if (typeof sourcePath !== "string" || out.type !== "image") {
        throw new Error("Attachment source must be a trusted Mains capture");
      }
      out.sourcePath = allowedSourcePath(sourcePath, captureDir);
    }
    return out;
  });
}
