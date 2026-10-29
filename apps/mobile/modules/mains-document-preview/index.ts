import { requireOptionalNativeModule } from "expo";

const preview = requireOptionalNativeModule<{ openAsync(uri: string, title: string): Promise<void> }>("MainsDocumentPreview");

export async function previewDocument(uri: string, title: string, _mimeType?: string): Promise<void> {
  if (!preview) throw new Error("Document preview requires an updated Mains build. You can still share this file.");
  await preview.openAsync(uri, title);
}
