import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import type { FileAttachment } from "@mains/contracts/runs";

const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

export interface ComposerAttachment {
  id: string;
  name: string;
  type: "image" | "document";
  uri: string;
  mimeType: string;
  size?: number;
  /** Presentation-only crop for generated previews; never sent over the wire. */
  previewCropBottom?: number;
}

export interface ComposerCameraCapture {
  uri: string;
  width: number;
  height: number;
}

function imageMimeType(name: string, reportedType?: string | null): string {
  if (reportedType) return reportedType;
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    default:
      return "image/jpeg";
  }
}

function extensionForImageMime(mimeType: string): string {
  return mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
}

function imageAttachment(
  asset: ImagePicker.ImagePickerAsset,
  index: number,
  fallbackPrefix: "image" | "photo",
): ComposerAttachment {
  const fallbackMimeType = imageMimeType("image.jpg", asset.mimeType);
  const name =
    asset.fileName?.trim() ||
    `${fallbackPrefix}-${Date.now()}-${index + 1}.${extensionForImageMime(fallbackMimeType)}`;
  return {
    id: `image:${asset.assetId ?? asset.uri}`,
    name,
    type: "image",
    uri: asset.uri,
    mimeType: imageMimeType(name, asset.mimeType),
    size: asset.fileSize,
  };
}

/** Pick phone-local images, matching the desktop's image attachment source. */
export async function pickComposerImages(): Promise<ComposerAttachment[]> {
  // PHPicker presents the photo library without granting the app blanket
  // access; iOS only hands us the assets the user explicitly selects.
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    allowsMultipleSelection: true,
    selectionLimit: 0,
    orderedSelection: true,
    quality: 1,
    shouldDownloadFromNetwork: true,
  });
  if (result.canceled) return [];

  return result.assets.map((asset, index) => imageAttachment(asset, index, "image"));
}

/** Turn a photo captured by the inline camera into a composer attachment. */
export function composerAttachmentFromCamera(
  capture: ComposerCameraCapture,
): ComposerAttachment {
  const name = `photo-${Date.now()}.jpg`;
  // expo-camera generates a 200×200 black test image with an orange timestamp
  // when iOS Simulator has no video device. Crop that generated footer only;
  // real camera captures keep their complete preview.
  const isSimulatorFallback = capture.width === 200 && capture.height === 200;
  return {
    id: `image:${capture.uri}`,
    name,
    type: "image",
    uri: capture.uri,
    mimeType: "image/jpeg",
    previewCropBottom: isSimulatorFallback ? 0.2 : undefined,
  };
}

/** Pick the same document families the desktop composer accepts. */
export async function pickComposerDocuments(): Promise<ComposerAttachment[]> {
  const result = await File.pickFileAsync({
    mimeTypes: [...DOCUMENT_MIME_TYPES],
    multipleFiles: true,
  });
  if (result.canceled) return [];

  return result.result.map((file) => ({
    id: `document:${file.uri}`,
    name: file.name,
    type: "document" as const,
    uri: file.uri,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  }));
}

/**
 * Is there an image on the clipboard right now? Answering this needs no
 * permission — iOS only guards reading the contents, not detecting them — so
 * the attach menu can offer Paste only when it would do something.
 */
export function clipboardHasImage(): Promise<boolean> {
  return Clipboard.hasImageAsync();
}

/**
 * The image on the clipboard, as an attachment.
 *
 * iOS hands it over as base64 rather than a file, and reading it is what
 * raises the system's "Allow Paste?" prompt — so this runs only from an
 * explicit Paste, never on its own. The bytes are written to the cache
 * directory because everything downstream (the strip's thumbnail, the
 * serializer) expects a file it can open.
 */
export async function pasteComposerImage(): Promise<ComposerAttachment[]> {
  const image = await Clipboard.getImageAsync({ format: "png" });
  if (!image?.data) return [];
  const name = `pasted-${Date.now()}.png`;
  const file = new File(Paths.cache, name);
  await Promise.resolve(file.write(image.data, { encoding: "base64" }));
  return [
    {
      id: `image:${file.uri}`,
      name,
      type: "image",
      uri: file.uri,
      mimeType: "image/png",
      size: file.size ?? undefined,
    },
  ];
}

/** Preserve insertion order while ignoring the same picked file twice. */
export function mergeComposerAttachments(
  current: ComposerAttachment[],
  picked: ComposerAttachment[],
): ComposerAttachment[] {
  const ids = new Set(current.map((attachment) => attachment.id));
  const merged = [...current];
  for (const attachment of picked) {
    if (ids.has(attachment.id)) continue;
    ids.add(attachment.id);
    merged.push(attachment);
  }
  return merged;
}

/** Read bytes only at send time so idle composer state stays lightweight. */
export async function serializeComposerAttachments(
  attachments: ComposerAttachment[],
): Promise<FileAttachment[]> {
  return Promise.all(
    attachments.map(async (attachment) => ({
      name: attachment.name,
      type: attachment.type,
      data: await new File(attachment.uri).base64(),
      mimeType: attachment.mimeType,
    })),
  );
}
