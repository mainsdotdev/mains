/** Local drafts carry a URI; persisted prompts carry a backend attachment id. */
export interface PromptImage {
  key: string;
  name: string;
  uri?: string;
  runId?: string;
  attachmentId?: string;
  previewCropBottom?: number;
}

/** Durable refs fetch small previews on demand; older data URLs still render. */
export function parsePromptImages(attachments: unknown, runId: string): PromptImage[] {
  if (!Array.isArray(attachments)) return [];
  const out: PromptImage[] = [];
  for (const [index, entry] of attachments.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const attachment = entry as { name?: unknown; type?: unknown; dataUrl?: unknown; attachmentId?: unknown };
    if (attachment.type !== "image" ||
      (typeof attachment.attachmentId !== "string" &&
        (typeof attachment.dataUrl !== "string" || !attachment.dataUrl.startsWith("data:image/")))) continue;
    const name = typeof attachment.name === "string" && attachment.name ? attachment.name : `image-${index + 1}`;
    out.push({
      key: `prompt-image:${index}:${name}`, name,
      ...(typeof attachment.attachmentId === "string"
        ? { runId, attachmentId: attachment.attachmentId }
        : { uri: attachment.dataUrl as string }),
    });
  }
  return out;
}
