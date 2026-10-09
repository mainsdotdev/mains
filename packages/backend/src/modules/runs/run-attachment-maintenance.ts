import { pruneAttachmentOrphans, pruneUnreferencedAttachments } from "./run-attachment-storage";
import { drainImagePreviews, pruneImagePreviews } from "../imageProxy";
import fs from "node:fs/promises";
import path from "node:path";
import { getBackendRuntime } from "../../runtime/backend-runtime";

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
    await pruneImagePreviews();
    // These disposable JPEGs were replaced by the shared image preview cache.
    await fs.rm(path.join(getBackendRuntime().getPath("userData"), "cache", "attachment-thumbnails"), { recursive: true, force: true });
  }).catch((error) => console.error("[attachments] background maintenance failed", error));
}

export async function stopAttachmentMaintenance(): Promise<void> {
  const state = running;
  if (state) { state.stopped = true; await state.task; }
  await drainImagePreviews();
  if (running === state) running = null;
}
