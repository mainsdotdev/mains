import type { UploadedFile } from "@/components/ui";
import type { BrowserChatUpload } from "../../../../shared/browser-chat-window";

/** Rebuild transient File objects after they cross the native chat IPC bridge. */
export function deserializeBrowserChatUploads(uploads: BrowserChatUpload[]): UploadedFile[] {
  return uploads.map((upload) => {
    const binary = atob(upload.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const file = new File([bytes], upload.name, { type: upload.mimeType });
    return {
      file,
      type: upload.type === "image" ? "image" : "document",
      preview: upload.type === "image" ? URL.createObjectURL(file) : undefined,
    };
  });
}
