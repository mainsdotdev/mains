/** Atlas stores Pages and explicitly saved files; generated files are projections. */
export type AtlasKind = "page" | "file" | "image";
export interface AtlasIdentity { accountId: string; id: string }
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
  /** Include a bounded Markdown excerpt of each Page's current revision. */
  includePagePreview?: boolean;
}
export interface AtlasListItem extends AtlasItem {
  /** Display-only excerpt; never used to edit or restore a Page. */
  preview?: string;
}
export interface AtlasGeneratedFile {
  sourceKey: string;
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
