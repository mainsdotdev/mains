/** Atlas stores Pages and explicitly saved files; generated files are projections. */
export type AtlasKind = "page" | "file" | "image";
export interface AtlasIdentity { accountId: string; id: string }
/** Portable Page reference, resolved inside the current Mains app and backend. */
export function atlasPageHref(id: string): string {
  return `/atlas/${encodeURIComponent(id)}`;
}
/** Page presentation is independent of its content revisions. */
export interface AtlasMetadata {
  /** Same emoji:/icon: format used by projects and spaces. */
  icon?: string;
  /** A permanently stored Atlas image, shared without copying its bytes. */
  coverFileId?: string;
}
export interface AtlasMetadataPatch {
  icon?: string | null;
  coverFileId?: string | null;
}
export interface AtlasItem {
  id: string;
  accountId: string;
  kind: AtlasKind;
  title: string;
  metadata: AtlasMetadata | null;
  collectionId: string | null;
  sourceRunId: string | null;
  sourceKey: string | null;
  path: string | null;
  fileName: string | null;
  mimeType: string | null;
  byteSize: number | null;
  isFavorite: boolean;
  trashedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface AtlasListOptions {
  accountId: string;
  kind?: AtlasKind;
  ids?: string[];
  trashed?: boolean;
  collectionId?: string;
  isFavorite?: boolean;
  /** Starts a bounded list; omitting limit with an offset uses 50 records. */
  offset?: number;
  limit?: number;
  /** Include a bounded Markdown excerpt of each Page's current revision. */
  includePagePreview?: boolean;
}
export interface AtlasListItem extends AtlasItem {
  /** Exact byte identity for image presentation; absent on older backends. */
  contentHash?: string;
  /** Display-only excerpt; never used to edit or restore a Page. */
  preview?: string;
}
export interface AtlasGeneratedFile {
  sourceKey: string;
  /** Deduplicate images across conversations and paginated results. */
  contentHash?: string;
  /** Omitted by older backends for generated outputs. Uploads are not creations. */
  origin?: "generated" | "attachment";
  runId: string;
  runTitle: string;
  collectionId: string | null;
  kind: "file" | "image";
  path: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  modifiedAt: string;
}
export interface AtlasGeneratedOptions {
  accountId: string;
  collectionId?: string;
  offset?: number;
  /** Paginate by conversations, with bounded output discovery per conversation. */
  limit?: number;
}
export interface AtlasGeneratedPage { items: AtlasGeneratedFile[]; nextOffset: number | null }
export const ATLAS_LIBRARY_PAGE_SIZE = 50;
export type AtlasLibraryScope = "all" | "generated" | "uploads" | "saved" | "favorites";
export interface AtlasLibraryOptions {
  accountId: string;
  type?: "all" | AtlasKind;
  scope?: AtlasLibraryScope;
  collectionId?: string;
  query?: string;
  page?: number;
  includePagePreview?: boolean;
}
export interface AtlasLibraryEntry {
  key: string;
  kind: AtlasKind;
  title: string;
  date: string;
  collectionId: string | null;
  path: string | null;
  contentHash?: string;
  saved?: AtlasListItem;
  generated?: AtlasGeneratedFile;
}
export interface AtlasLibraryPage {
  items: AtlasLibraryEntry[];
  page: number;
  hasNext: boolean;
  /** Only permanent images referenced by the current page's bounded previews. */
  previewImages: Record<string, string>;
}
export interface AtlasPageRevision {
  id: string;
  itemId: string;
  version: number;
  schemaVersion: number;
  title: string;
  blocks: unknown[];
  markdown: string;
  actor: "user" | "agent";
  sourceRunId: string | null;
  createdAt: string;
}
export interface AtlasPage { item: AtlasItem; revision: AtlasPageRevision }
export interface AtlasCreatePage {
  accountId: string;
  title: string;
  collectionId?: string | null;
  blocks?: unknown[];
  markdown?: string;
}
export interface AtlasSavePage extends AtlasIdentity {
  expectedVersion: number;
  title: string;
  blocks?: unknown[];
  markdown?: string;
}
export interface AtlasSaveFile {
  accountId: string;
  runId: string;
  path: string;
}
export interface AtlasUploadFile {
  accountId: string;
  pageId: string;
  fileName: string;
  /** Base64 file contents, used for a Page's embedded local files. */
  data: string;
}
export interface AtlasUpdateItem extends AtlasIdentity {
  title?: string;
  collectionId?: string | null;
  isFavorite?: boolean;
  trashed?: boolean;
  /** Merge only supplied keys; null removes a key (or all metadata). */
  metadata?: AtlasMetadataPatch | null;
}
