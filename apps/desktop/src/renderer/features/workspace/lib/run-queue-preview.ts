import type { UploadedFile } from "@/components/ui";
import type { ConversationQueue, QueuedRunMessage } from "@/lib/redux/slices/runQueueSlice";
import type { ContextItem } from "./composer-context";

export interface QueuedMessagePreview {
  attachment?: { type: "image" | "file"; name: string; src?: string };
  label: string;
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|heic|avif|svg)$/i;

function contextAttachment(item: ContextItem): QueuedMessagePreview["attachment"] {
  if (item.kind === "file") {
    return IMAGE_EXTENSION.test(item.name)
      ? { type: "image", name: item.name, src: item.fullPath }
      : { type: "file", name: item.name };
  }
  if (item.kind === "browser" || item.kind === "appshot") {
    return {
      type: "image",
      name: item.kind === "appshot" ? item.windowTitle || item.appName : item.title || "Browser capture",
      src: item.screenshotCaptureName ? `mains-capture://cap/${item.screenshotCaptureName}` : item.screenshotPath,
    };
  }
  return undefined;
}

/** One representative attachment; the original message still carries every file. */
export function buildQueuedMessagePreview(message: QueuedRunMessage, uploads: readonly UploadedFile[]): QueuedMessagePreview {
  const attachments: NonNullable<QueuedMessagePreview["attachment"]>[] = uploads.length
    ? uploads.map((upload) => ({ type: upload.type === "image" ? "image" as const : "file" as const, name: upload.file.name, src: upload.preview }))
    : message.attachmentNames.map((name) => ({ type: IMAGE_EXTENSION.test(name) ? "image" as const : "file" as const, name }));
  for (const item of message.contextItems) {
    const attachment = contextAttachment(item);
    if (attachment) attachments.push(attachment);
  }
  const attachment = attachments[0];
  let label = message.text;
  if (!label.trim()) {
    if (!attachment) label = "Attached context";
    else if (attachments.every((entry) => entry.type === "image")) label = `${attachments.length} image${attachments.length === 1 ? "" : "s"}`;
    else if (attachments.length === 1) label = attachment.name;
    else label = `${attachments.length} ${attachments.every((entry) => entry.type === "file") ? "files" : "attachments"}`;
  }
  return { attachment, label };
}

const thumbnails = new WeakMap<File, Promise<string | undefined>>();

function nativeThumbnail(file: File): Promise<string | undefined> {
  const cached = thumbnails.get(file);
  if (cached) return cached;
  const pending = (async () => {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } finally {
      bitmap.close();
    }
  })().catch(() => undefined);
  thumbnails.set(file, pending);
  return pending;
}

/** Blob URLs belong to the parent renderer; mirror only a small image to the child. */
export async function queueForBrowserChat(queue: ConversationQueue, uploadsForOwner: (owner: string) => UploadedFile[]): Promise<ConversationQueue> {
  const messages = await Promise.all(queue.messages.map(async (message) => {
    const uploads = uploadsForOwner(message.uploadOwnerKey);
    const preview = buildQueuedMessagePreview(message, uploads);
    if (uploads[0]?.type === "image" && preview.attachment) {
      preview.attachment = { ...preview.attachment, src: await nativeThumbnail(uploads[0].file) };
    }
    return { ...message, preview };
  }));
  return { ...queue, messages };
}
