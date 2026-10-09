import type { ArtifactImage, ReadAttachmentImagePayload } from "@mains/contracts/runs";
import { readImagePreview } from "../imageProxy";
import { resolveRunAttachment } from "./run-attachment-storage";

export const ATTACHMENT_THUMBNAIL_SIDE = 256;
export const ATTACHMENT_PREVIEW_MAX_SIDE = 1600;

export async function readAttachmentImage(payload: ReadAttachmentImagePayload): Promise<ArtifactImage> {
  const requested = payload.maxSide ?? ATTACHMENT_THUMBNAIL_SIDE;
  if (typeof requested !== "number" || !Number.isFinite(requested)) throw new Error("Invalid image preview size");
  const maxSide = Math.min(ATTACHMENT_PREVIEW_MAX_SIDE, Math.max(128, Math.round(requested)));
  // Ownership is checked on every request, including shared cache hits.
  const original = await resolveRunAttachment(payload.runId, payload.attachmentId);
  if (original.attachment.type !== "image") throw new Error("Not an image attachment");
  const preview = await readImagePreview(original.path, maxSide, { cache: maxSide === ATTACHMENT_THUMBNAIL_SIDE });
  return { mime: preview.mime, base64: preview.bytes.toString("base64"), width: preview.width, height: preview.height };
}
