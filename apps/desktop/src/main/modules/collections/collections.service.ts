import { createHash, randomUUID } from "crypto";
import { collectionsRepo } from "./collections.repo";
import {
  validateAddCollectionSource,
  validateCollectionIdentity,
  validateCreateCollection,
  validateUpdateCollection,
} from "./collections.validation";
import type {
  CollectionIdentityOptions,
  CollectionResponse,
  CollectionSourceResponse,
  CollectionSourceMaterial,
  ListCollectionsOptions,
  ListCollectionSourcesOptions,
  RemoveCollectionSourcePayload,
} from "./collections.dto";
import {
  removeCollectionSourceStorage,
  resolveCollectionSourceStorage,
  stageCollectionSourceStorageRemoval,
  stageCollectionStorageRemoval,
  writeCollectionSource,
} from "./collections.storage";

const MAX_FILE_SOURCE_BYTES = 20 * 1024 * 1024;

function decodeBase64(data: string): Buffer {
  const normalized = data.replace(/\s/g, "");
  if (normalized.length > Math.ceil(MAX_FILE_SOURCE_BYTES / 3) * 4 + 4) {
    throw new Error("Collection source file is too large (maximum 20 MB)");
  }
  if (normalized && !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Collection source data is not valid base64");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.byteLength > MAX_FILE_SOURCE_BYTES) {
    throw new Error("Collection source file is too large (maximum 20 MB)");
  }
  return bytes;
}

async function requireOwnedCollection(
  collectionId: string,
  accountId: string,
): Promise<CollectionResponse> {
  const collection = await findOwnedCollection({ id: collectionId, accountId });
  if (!collection) throw new Error("Collection not found");
  return collection;
}

async function findOwnedCollection(
  options: CollectionIdentityOptions,
): Promise<CollectionResponse | null> {
  const { id, accountId } = validateCollectionIdentity(options);
  const collection = await collectionsRepo.findById(id);
  if (!collection) return null;
  if (collection.accountId !== accountId) {
    throw new Error("Collection does not belong to this account");
  }
  return collection;
}

export const collectionsService = {
  async list(options: ListCollectionsOptions): Promise<CollectionResponse[]> {
    return collectionsRepo.list(options);
  },

  async get(
    options: CollectionIdentityOptions,
  ): Promise<CollectionResponse | null> {
    return findOwnedCollection(options);
  },

  async create(payload: unknown): Promise<CollectionResponse> {
    const data = validateCreateCollection(payload);
    const id = data.id ?? randomUUID();
    await collectionsRepo.insert({ ...data, id });
    const created = await collectionsRepo.findById(id);
    if (!created) throw new Error("Failed to create collection");
    return created;
  },

  async update(
    options: CollectionIdentityOptions,
    payload: unknown,
  ): Promise<CollectionResponse> {
    const collection = await requireOwnedCollection(
      options.id,
      options.accountId,
    );
    const data = validateUpdateCollection(payload);
    const updated = await collectionsRepo.update(
      collection.id,
      collection.accountId,
      data,
    );
    if (!updated) throw new Error("Collection not found");
    return updated;
  },

  async archive(
    options: CollectionIdentityOptions,
  ): Promise<CollectionResponse> {
    const collection = await requireOwnedCollection(
      options.id,
      options.accountId,
    );
    const archived = await collectionsRepo.setArchived(
      collection.id,
      collection.accountId,
      true,
    );
    if (!archived) throw new Error("Collection not found");
    return archived;
  },

  async unarchive(
    options: CollectionIdentityOptions,
  ): Promise<CollectionResponse> {
    const collection = await requireOwnedCollection(
      options.id,
      options.accountId,
    );
    const restored = await collectionsRepo.setArchived(
      collection.id,
      collection.accountId,
      false,
    );
    if (!restored) throw new Error("Collection not found");
    return restored;
  },

  /** Removing a Collection preserves its runs; the FK detaches them. */
  async remove(options: CollectionIdentityOptions): Promise<void> {
    const collection = await requireOwnedCollection(
      options.id,
      options.accountId,
    );
    const stagedStorage = stageCollectionStorageRemoval(collection.id);
    try {
      const removed = await collectionsRepo.remove(
        collection.id,
        collection.accountId,
      );
      if (!removed) throw new Error("Collection not found");
      stagedStorage.commit();
    } catch (error) {
      stagedStorage.restore();
      throw error;
    }
  },

  async listSources(
    options: ListCollectionSourcesOptions,
  ): Promise<CollectionSourceResponse[]> {
    await requireOwnedCollection(options.collectionId, options.accountId);
    return collectionsRepo.listSources(options.collectionId);
  },

  /** Internal Interface used by Runs to snapshot the current Sources. */
  async getSourceMaterials(
    options: ListCollectionSourcesOptions,
  ): Promise<CollectionSourceMaterial[]> {
    await requireOwnedCollection(options.collectionId, options.accountId);
    const sources = await collectionsRepo.listSourceRecords(options.collectionId);
    return sources.map((source) => ({
      id: source.id,
      collectionId: source.collectionId,
      kind: source.kind,
      name: source.name,
      mimeType: source.mimeType,
      byteSize: source.byteSize,
      contentHash: source.contentHash,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      absolutePath: resolveCollectionSourceStorage({
        collectionId: source.collectionId,
        sourceId: source.id,
        name: source.name,
        storageKey: source.storageKey,
      }),
    }));
  },

  async addSource(payload: unknown): Promise<CollectionSourceResponse> {
    const data = validateAddCollectionSource(payload);
    const collection = await requireOwnedCollection(
      data.collectionId,
      data.accountId,
    );
    if (collection.isArchived) {
      throw new Error("Archived collections cannot accept sources");
    }

    const bytes =
      data.kind === "file"
        ? decodeBase64(data.data)
        : Buffer.from(data.text, "utf8");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const existing = await collectionsRepo.findSourceByHash(
      collection.id,
      contentHash,
    );
    if (existing) return existing;

    const id = randomUUID();
    const storageKey = writeCollectionSource({
      collectionId: collection.id,
      sourceId: id,
      name: data.name,
      bytes,
    });
    const now = new Date();
    try {
      await collectionsRepo.insertSource({
        id,
        collectionId: collection.id,
        kind: data.kind,
        name: data.name,
        mimeType: data.kind === "file" ? data.mimeType : "text/plain",
        byteSize: bytes.byteLength,
        contentHash,
        storageKey,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      removeCollectionSourceStorage({
        collectionId: collection.id,
        sourceId: id,
      });
      throw error;
    }

    const created = await collectionsRepo.findSourceById(id);
    if (!created) throw new Error("Failed to create collection source");
    return {
      id: created.id,
      collectionId: created.collectionId,
      kind: created.kind,
      name: created.name,
      mimeType: created.mimeType,
      byteSize: created.byteSize,
      contentHash: created.contentHash,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  },

  async removeSource(payload: RemoveCollectionSourcePayload): Promise<void> {
    const source = await collectionsRepo.findSourceById(payload.id);
    if (!source) throw new Error("Collection source not found");
    await requireOwnedCollection(source.collectionId, payload.accountId);
    const stagedStorage = stageCollectionSourceStorageRemoval({
      collectionId: source.collectionId,
      sourceId: source.id,
    });
    try {
      await collectionsRepo.removeSource(source.id);
      stagedStorage.commit();
    } catch (error) {
      stagedStorage.restore();
      throw error;
    }
  },
};
