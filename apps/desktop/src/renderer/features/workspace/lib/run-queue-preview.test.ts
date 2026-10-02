import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadedFile } from "@/components/ui";
import type { ConversationQueue, QueuedRunMessage } from "@/lib/redux/slices/runQueueSlice";
import { buildQueuedMessagePreview, queueForBrowserChat } from "./run-queue-preview";

function message(overrides: Partial<QueuedRunMessage> = {}): QueuedRunMessage {
  return { id: "input", text: "", contextItems: [], attachmentNames: [], uploadOwnerKey: "input-files", status: "queued", ...overrides };
}

function upload(name: string, type: UploadedFile["type"] = "image"): UploadedFile {
  return { file: new File(["bytes"], name, { type: type === "image" ? "image/png" : "application/pdf" }), type, preview: type === "image" ? `blob:${name}` : undefined };
}

afterEach(() => vi.unstubAllGlobals());

describe("queued message attachment previews", () => {
  it("keeps text-only prompts compact without an attachment", () => {
    expect(buildQueuedMessagePreview(message({ text: "continue" }), [])).toEqual({ label: "continue", attachment: undefined });
  });

  it("uses the first image beside the text even when many attachments are queued", () => {
    const files = [upload("first.png"), upload("second.png"), upload("notes.pdf", "document")];
    const preview = buildQueuedMessagePreview(message({ text: "Inspect these" }), files);
    expect(preview).toEqual({ label: "Inspect these", attachment: { type: "image", name: "first.png", src: "blob:first.png" } });
    expect(files).toHaveLength(3);
  });

  it("labels image-only and mixed messages by their attachment count", () => {
    expect(buildQueuedMessagePreview(message(), [upload("first.png")]).label).toBe("1 image");
    expect(buildQueuedMessagePreview(message(), [upload("first.png"), upload("second.png")]).label).toBe("2 images");
    expect(buildQueuedMessagePreview(message(), [upload("notes.pdf", "document"), upload("second.png")])).toEqual({
      label: "2 attachments", attachment: { type: "file", name: "notes.pdf", src: undefined },
    });
    expect(buildQueuedMessagePreview(message(), [upload("notes.pdf", "document")]).label).toBe("notes.pdf");
  });

  it("shows context images and file icons without requiring an uploaded File", () => {
    const contextItems: QueuedRunMessage["contextItems"] = [
      { kind: "file", type: "file", name: "photo.png", fullPath: "/workspace/photo.png" },
      { kind: "file", type: "file", name: "notes.pdf", fullPath: "/workspace/notes.pdf" },
    ];
    expect(buildQueuedMessagePreview(message({ text: "Review", contextItems }), [])).toEqual({
      label: "Review", attachment: { type: "image", name: "photo.png", src: "/workspace/photo.png" },
    });
    expect(buildQueuedMessagePreview(message({ contextItems: contextItems.slice(1) }), [])).toEqual({ label: "notes.pdf", attachment: { type: "file", name: "notes.pdf" } });
  });

  it("mirrors a bounded cached thumbnail to the native chat without changing the original files", async () => {
    const file = upload("image.png");
    const bitmap = { width: 1200, height: 600, close: vi.fn() };
    const decode = vi.fn(async () => bitmap);
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: () => "data:image/png;base64,thumbnail" };
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("document", { createElement: () => canvas });
    const queue: ConversationQueue = { backendId: "local", runId: "run", mode: "queue", runStatus: "running", messages: [message({ attachmentNames: [file.file.name] })] };
    const [first, second] = await Promise.all([queueForBrowserChat(queue, () => [file]), queueForBrowserChat(queue, () => [file])]);
    expect(first.messages[0].preview?.attachment?.src).toBe("data:image/png;base64,thumbnail");
    expect(second.messages[0].preview).toEqual(first.messages[0].preview);
    expect(decode).toHaveBeenCalledExactlyOnceWith(file.file);
    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(48);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(queue.messages[0].preview).toBeUndefined();
    expect(file.preview).toBe("blob:image.png");
  });

  it("falls back to an image icon in the child if thumbnail decoding fails", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("unsupported image"); }));
    const queue: ConversationQueue = { backendId: "local", runId: "run", mode: "queue", runStatus: "running", messages: [message()] };
    const display = await queueForBrowserChat(queue, () => [upload("photo.heic")]);
    expect(display.messages[0].preview).toEqual({ label: "1 image", attachment: { type: "image", name: "photo.heic", src: undefined } });
    expect(queue.messages).toHaveLength(1);
  });
});
