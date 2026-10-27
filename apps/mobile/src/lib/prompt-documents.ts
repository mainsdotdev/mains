export interface PromptDocument {
  key: string;
  name: string;
  mimeType?: string;
  byteSize?: number;
  runId: string;
  attachmentId?: string;
  pending?: boolean;
}

/** History contains descriptors only. Legacy documents stay visible without trusting host paths. */
export function parsePromptDocuments(attachments: unknown, runId: string): PromptDocument[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || entry.type !== "document") return [];
    const attachmentId = typeof entry.attachmentId === "string" && /^[a-f0-9]{64}$/.test(entry.attachmentId) ? entry.attachmentId : undefined;
    return [{ key: `prompt-document:${index}:${attachmentId ?? "legacy"}`, runId,
      name: typeof entry.name === "string" && entry.name ? entry.name.split(/[\\/]/).pop() || "Document" : "Document",
      ...(attachmentId ? { attachmentId } : {}),
      ...(typeof entry.mimeType === "string" ? { mimeType: entry.mimeType } : {}),
      ...(Number.isSafeInteger(entry.byteSize) && entry.byteSize >= 0 ? { byteSize: entry.byteSize as number } : {}),
    }];
  });
}
