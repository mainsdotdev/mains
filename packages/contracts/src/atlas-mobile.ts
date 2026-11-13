import type { AtlasKind, AtlasLibraryOptions } from "./atlas";
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
}
export interface AtlasMobileLibraryPage { items: AtlasMobileEntry[]; page: number; hasNext: boolean }
export interface AtlasMobilePageRequest {
  accountId: string; id: string; offset?: number; version?: number;
}
/** Offsets count Unicode scalars; each response contains at most 16,384 scalars. */
export interface AtlasMobilePage {
  id: string; title: string; icon: string | null; version: number;
  markdown: string; offset: number; nextOffset: number | null;
  sourceRunId: string | null;
}
export interface AtlasMobileFileRequest { accountId: string; reference: AtlasMobileFileReference }
export interface AtlasMobileFile {
  reference: AtlasMobileFileReference; name: string; mimeType: string; byteSize: number;
  modifiedAt: number; version: string; previewType: OutputPreviewType;
}
export interface AtlasMobileFileRead extends AtlasMobileFileRequest { offset: number; version: string }

/** Exactly one conversation-owned identity; paths and uploaded bytes are never accepted. */
export interface AtlasMobileSaveFile {
  accountId: string; runId: string; version: string;
  artifactId?: number; attachmentId?: string; sourceKey?: string;
}
export interface AtlasMobileSaveBookmark { accountId: string; url: string; collectionId?: string | null }
export interface AtlasMobileSavedItem { id: string; title: string; kind: AtlasKind }
export interface AtlasMobileUpdateItem {
  accountId: string; id: string; isFavorite?: boolean; collectionId?: string | null;
}
export interface AtlasMobileItemState extends AtlasMobileSavedItem { requestedId: string; isFavorite: boolean; collectionId: string | null }
export interface AtlasMobileBookmark extends AtlasMobileSavedItem {
  kind: "bookmark"; requestedId: string; url: string; description: string; note: string; revision: string;
}
export interface AtlasMobileBookmarkIdentity { accountId: string; id: string }
export interface AtlasMobileEditBookmark extends AtlasMobileBookmarkIdentity {
  expectedRevision: string; title?: string; description?: string; note?: string;
}
export interface AtlasMobileBookmarkEditResult extends AtlasMobileSavedItem { requestedId: string; revision: string }
