import { pruneAttachmentOrphans, pruneUnreferencedAttachments } from "./run-attachment-storage";
import { drainAttachmentImages, pruneAttachmentThumbnails } from "./run-attachment-images";

let running: { stopped: boolean; task: Promise<void> } | null = null;

/** Maintain new attachment files and previews without scanning existing prompts. */
export function startAttachmentMaintenance(): void {
  if (running) return;
  const state = { stopped: false, task: Promise.resolve() };
  running = state;
  state.task = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
    if (state.stopped) return;
    await pruneUnreferencedAttachments();
    await pruneAttachmentOrphans();
    await pruneAttachmentThumbnails();
  }).catch((error) => console.error("[attachments] background maintenance failed", error));
}

export async function stopAttachmentMaintenance(): Promise<void> {
  const state = running;
  if (state) { state.stopped = true; await state.task; }
  await drainAttachmentImages();
  if (running === state) running = null;
}
