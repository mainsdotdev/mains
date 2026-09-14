import type { UploadedFile } from "@/components/ui";

export interface SerializedAttachment {
  name: string;
  type: string;
  data: string;
  mimeType: string;
}

/** Convert UploadedFile[] to base64-encoded attachments for IPC transport */
export function serializeAttachments(files: UploadedFile[]): Promise<SerializedAttachment[]> {
  return Promise.all(
    files.map(
      (f) =>
        new Promise<SerializedAttachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1] || "";
            resolve({
              name: f.file.name,
              type: f.type,
              data: base64,
              mimeType: f.file.type || "application/octet-stream",
            });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(f.file);
        }),
    ),
  );
}

