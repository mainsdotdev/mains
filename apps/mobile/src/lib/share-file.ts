import { Share } from "react-native";

/** Keep the native iOS file share sheet independent of Android's file provider. */
export async function shareFile(uri: string, _mimeType?: string): Promise<void> {
  await Share.share({ url: uri });
}
