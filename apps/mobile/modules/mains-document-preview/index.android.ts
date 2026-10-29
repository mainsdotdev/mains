import { Directory, File, Paths } from "expo-file-system";
import { startActivityAsync } from "expo-intent-launcher";

import { isCachedDocumentUri } from "./cached-document";

export async function previewDocument(uri: string, _title: string, mimeType?: string): Promise<void> {
  const file = new File(uri);
  if (!isCachedDocumentUri(file.uri, new Directory(Paths.cache, "mains-outputs").uri) || !file.exists) {
    throw new Error("Download this file again before opening it.");
  }
  try {
    await startActivityAsync("android.intent.action.VIEW", {
      data: file.contentUri, type: mimeType || file.type || "application/octet-stream",
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION, for this file only.
    });
  } catch {
    throw new Error("Could not open this file. Install an app that supports this format, or use Share.");
  }
}
