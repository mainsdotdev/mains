import * as Sharing from "expo-sharing";

/** Grant the chosen receiving app read access to the selected cached file. */
export async function shareFile(uri: string, mimeType?: string): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error("File sharing is unavailable on this device.");
  await Sharing.shareAsync(uri, { mimeType });
}
