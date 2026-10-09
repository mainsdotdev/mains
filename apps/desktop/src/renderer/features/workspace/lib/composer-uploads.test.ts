// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { addComposerUploads } from "./composer-uploads";

afterEach(() => vi.unstubAllGlobals());

describe("addComposerUploads", () => {
  it("keeps the composer formats, previews, and existing attachments", () => {
    const NativeURL = URL;
    vi.stubGlobal("URL", class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:photo");
    });
    const existing = { file: new File(["old"], "old.txt"), type: "document" as const };
    const photo = new File(["photo"], "photo.heic");
    const document = new File(["document"], "notes.pdf");
    const unsupported = new File(["archive"], "archive.zip");
    const change = vi.fn();

    expect(addComposerUploads([photo, document, unsupported], [existing], change)).toBe(true);
    expect(change).toHaveBeenCalledExactlyOnceWith([
      existing,
      { file: photo, type: "image", preview: "blob:photo" },
      { file: document, type: "document", preview: undefined },
    ]);
    expect(addComposerUploads([document, unsupported], [], change, "images")).toBe(false);
    expect(change).toHaveBeenCalledOnce();
  });
});
