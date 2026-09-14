import type { collectionSources, collections } from "../../db/schema";

export type CollectionRecord = typeof collections.$inferSelect;

export interface CollectionResponse {
  id: string;
  accountId: string;
  name: string;
  icon: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListCollectionsOptions {
  accountId: string;
  includeArchived?: boolean;
}

export interface CollectionIdentityOptions {
  id: string;
  accountId: string;
}

export interface CreateCollectionPayload {
  id?: string;
  accountId: string;
  name: string;
  icon?: string;
}

export interface UpdateCollectionPayload {
  name?: string;
  icon?: string | null;
}

export type CollectionSourceRecord = typeof collectionSources.$inferSelect;
export type CollectionSourceKind = CollectionSourceRecord["kind"];

export interface CollectionSourceResponse {
  id: string;
  collectionId: string;
  kind: CollectionSourceKind;
  name: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Main-process-only material used when a run snapshots Collection context. */
export interface CollectionSourceMaterial extends CollectionSourceResponse {
  absolutePath: string;
}

export interface ListCollectionSourcesOptions {
  accountId: string;
  collectionId: string;
}

interface AddCollectionSourceBase {
  accountId: string;
  collectionId: string;
  name: string;
}

export type AddCollectionSourcePayload =
  | (AddCollectionSourceBase & {
      kind: "file";
      mimeType: string;
      data: string;
    })
  | (AddCollectionSourceBase & {
      kind: "text";
      text: string;
    });

export interface RemoveCollectionSourcePayload {
  accountId: string;
  id: string;
}

export function formatCollectionResponse(
  record: CollectionRecord,
): CollectionResponse {
  return {
    id: record.id,
    accountId: record.accountId,
    name: record.name,
    icon: record.icon,
    isArchived: record.isArchived,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function formatCollectionSourceResponse(
  record: CollectionSourceRecord,
): CollectionSourceResponse {
  return {
    id: record.id,
    collectionId: record.collectionId,
    kind: record.kind,
    name: record.name,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    contentHash: record.contentHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
