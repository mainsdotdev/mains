/** PR media stays local until Create; chunks keep videos out of large IPC frames. */
export const PR_ATTACHMENT_CHUNK_BYTES = 1024 * 1024;
export const PR_ATTACHMENT_LIMIT = 50;
/** Includes the branch push, optional generation, and GitHub media upload. */
export const PR_MEDIA_CREATE_TIMEOUT_MS = 10 * 60_000;
export const PR_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PR_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
/** Draft identity, never a local file path or a GitHub URL. */
export function prAttachmentUrl(id: string): string { return `mains-pr-attachment:${id}`; }
export function prAttachmentId(url: string | undefined): string | undefined {
  return url?.match(/^mains-pr-attachment:([A-Za-z0-9_-]+)$/)?.[1];
}
export function mapPrAttachmentUrls(body: string, resolve: (id: string) => string): string {
  return body.replace(/mains-pr-attachment:([A-Za-z0-9_-]+)/g, (_url, id: string) => resolve(id));
}
export const PR_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

export function prMediaType(name: string): string | undefined {
  return PR_MEDIA_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
}

export function validatePrMedia(name: string, size: number): string | null {
  const type = prMediaType(name);
  if (!type) return "Choose a PNG, JPEG, GIF, WebP, SVG, MP4, MOV or WebM file.";
  if (!Number.isSafeInteger(size) || size <= 0) return "The attachment is empty or has an invalid size.";
  const limit = type.startsWith("image/") ? PR_IMAGE_MAX_BYTES : PR_VIDEO_MAX_BYTES;
  return size > limit ? `${name} exceeds the ${limit / 1024 / 1024} MB limit.` : null;
}

export interface PrAttachmentChunk {
  workspaceId: string;
  /** Omitted on the first chunk. The backend assigns the temporary upload id. */
  uploadId?: string;
  name: string;
  size: number;
  offset: number;
  data: string;
}

export interface CreatePrResult {
  url: string;
  /** The PR exists, but at least one media upload failed. Do not create it again. */
  warning?: string;
}

export interface CreatePrPayload {
  workspaceId: string;
  title?: string;
  body?: string;
  base?: string;
  draft?: boolean;
  providerId?: string;
  model?: string;
  attachmentIds?: string[];
}
