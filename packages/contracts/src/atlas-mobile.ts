import type { AtlasKind, AtlasLibraryOptions, AtlasItemTag, AtlasTag } from "./atlas";
import type { OutputPreviewType } from "./run-outputs";

/** Phone DTOs. Host paths and canonical Page blocks never travel here. */
export type AtlasMobileLibraryOptions = Omit<AtlasLibraryOptions, "includePagePreview">;
export type AtlasMobileFileReference = { itemId: string; runId?: never; sourceKey?: never }
  | { runId: string; sourceKey: string; itemId?: never };
export interface AtlasMobileEntry {
  key: string;
  kind: AtlasKind;
  title: string;
  date: string;
  collectionId: string | null;
  isFavorite: boolean;
  /** Permanent copy being organized; generated-only projections have no saved identity. */
  savedItemId: string | null;
  savedCollectionId: string | null;
  origin: "saved" | "generated" | "attachment";
  sourceRunId: string | null;
  file: AtlasMobileFileReference | null;
  pageId: string | null;
  icon: string | null;
  url: string | null;
  description: string | null;
  note: string | null;
  tags: AtlasItemTag[];
  /** Optional display metadata; absent on older computers. No host paths. */
  fileName?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  /** At most 240 Unicode scalars of display-only Page text. */
  preview?: string | null;
}
export interface AtlasMobileLibraryPage { items: AtlasMobileEntry[]; page: number; hasNext: boolean }
export interface AtlasMobilePageRequest {
  accountId: string; id: string; offset?: number; version?: number;
}
/** Offsets count Unicode scalars; each response contains at most 16,384 scalars. */
export interface AtlasMobilePage {
  id: string; title: string; icon: string | null; version: number;
  /** Optional on older computers. A stored image identity, never a host path. */
  coverFileId?: string | null;
  markdown: string; offset: number; nextOffset: number | null;
  sourceRunId: string | null;
}
export interface AtlasMobilePageCoverRequest { accountId: string; id: string; coverFileId: string }
/** Fixed 768-pixel Page cover, at most 512 KiB; selected by its owning Page. */
export interface AtlasMobilePageCover extends Omit<AtlasMobileImage, "reference"> { pageId: string; coverFileId: string }
/** Read one stored image from the pinned Page revision, without returning blocks or paths. */
export interface AtlasMobilePageImageRequest { accountId: string; id: string; fileId: string; version: number }
export interface AtlasMobilePageImage extends Omit<AtlasMobileImage, "reference"> { pageId: string; fileId: string; pageVersion: number }
export interface AtlasMobileFileRequest { accountId: string; reference: AtlasMobileFileReference }
export interface AtlasMobileFile {
  reference: AtlasMobileFileReference; name: string; mimeType: string; byteSize: number;
  modifiedAt: number; version: string; previewType: OutputPreviewType;
  /** Page assets are stored but unlisted until explicitly saved; absent on older hosts. */
  canSaveToLibrary?: boolean;
}
export interface AtlasMobileFileRead extends AtlasMobileFileRequest { offset: number; version: string }
/** Fixed 128-pixel file or stored bookmark thumbnail, at most 128 KiB; never the original file. */
export interface AtlasMobileImage {
  reference: AtlasMobileFileReference; version: string;
  mime: "image/jpeg" | "image/png"; base64: string; width: number; height: number;
}

/** Exactly one stored or conversation-owned identity; no paths or uploaded bytes. */
export interface AtlasMobileSaveFile {
  accountId: string; runId?: string; version: string;
  artifactId?: number; attachmentId?: string; sourceKey?: string;
  /** Exclusive with conversation-owned identities. Promotes this stored file in place. */
  itemId?: string;
}
export interface AtlasMobileSaveBookmark { accountId: string; url: string; collectionId?: string | null }
export interface AtlasMobileSavedItem { id: string; title: string; kind: AtlasKind }
/** Read-only permanence check for the same version-checked identity used by Save. */
export interface AtlasMobileSaveStatus { saved: boolean }
export interface AtlasMobileUpdateItem {
  accountId: string; id: string; isFavorite?: boolean; collectionId?: string | null;
}
export interface AtlasMobileItemState extends AtlasMobileSavedItem { requestedId: string; isFavorite: boolean; collectionId: string | null }
export interface AtlasMobileBookmark extends AtlasMobileSavedItem {
  kind: "bookmark"; requestedId: string; url: string; description: string; note: string; revision: string;
  /** Fresh detail metadata, optional on older computers. No preview URLs or storage paths. */
  isFavorite?: boolean; collectionId?: string | null; tags?: AtlasItemTag[]; hasImage?: boolean;
}
export interface AtlasMobileBookmarkIdentity { accountId: string; id: string }
export interface AtlasMobileEditBookmark extends AtlasMobileBookmarkIdentity {
  expectedRevision: string; title?: string; description?: string; note?: string;
}
export interface AtlasMobileBookmarkEditResult extends AtlasMobileSavedItem { requestedId: string; revision: string }
export interface AtlasMobileTrashOptions { accountId: string; page?: number }
export interface AtlasMobileTrashItem extends AtlasMobileSavedItem { collectionId: string | null; trashedAt: string }
export interface AtlasMobileTrashPage { items: AtlasMobileTrashItem[]; page: number; hasNext: boolean }
export interface AtlasMobileSetTrash { accountId: string; id: string; trashed: boolean }
export interface AtlasMobileTrashState extends AtlasMobileSavedItem { requestedId: string; trashed: boolean }
export interface AtlasMobileTagsOptions { accountId: string; query?: string; page?: number }
export interface AtlasMobileTagsPage { items: AtlasTag[]; page: number; hasNext: boolean }
export interface AtlasMobileItemTags extends AtlasMobileSavedItem { requestedId: string; tags: AtlasItemTag[]; revision: string }
/** Existing account tag ids and new names, following the desktop's 30/64 limits. */
export interface AtlasMobileSetTags extends AtlasMobileBookmarkIdentity { tags: string[]; expectedRevision: string }
export interface AtlasMobileTagsResult extends AtlasMobileSavedItem { requestedId: string; revision: string }
