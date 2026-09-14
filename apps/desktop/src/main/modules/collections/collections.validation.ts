import type {
  AddCollectionSourcePayload,
  CollectionIdentityOptions,
  CreateCollectionPayload,
  UpdateCollectionPayload,
} from "./collections.dto";

const MAX_SOURCE_NAME_LENGTH = 255;
const MAX_TEXT_SOURCE_BYTES = 1024 * 1024;

const CREATE_FIELDS = new Set(["id", "accountId", "name", "icon"]);
const UPDATE_FIELDS = new Set(["name", "icon"]);

function sanitize(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => allowed.has(key)),
  );
}

export function validateCreateCollection(
  payload: unknown,
): CreateCollectionPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Collection payload must be an object");
  }
  const obj = payload as Record<string, unknown>;
  if (typeof obj.accountId !== "string" || !obj.accountId.trim()) {
    throw new Error("accountId is required");
  }
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    throw new Error("Collection name is required");
  }
  if (obj.id !== undefined && typeof obj.id !== "string") {
    throw new Error("Collection id must be a string");
  }
  if (obj.icon !== undefined && typeof obj.icon !== "string") {
    throw new Error("Collection icon must be a string");
  }
  const data = sanitize(obj, CREATE_FIELDS);
  return {
    ...(data as unknown as CreateCollectionPayload),
    name: obj.name.trim(),
  };
}

export function validateCollectionIdentity(
  payload: unknown,
): CollectionIdentityOptions {
  if (!payload || typeof payload !== "object") {
    throw new Error("Collection identity must be an object");
  }
  const obj = payload as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id.trim()) {
    throw new Error("Collection id is required");
  }
  if (typeof obj.accountId !== "string" || !obj.accountId.trim()) {
    throw new Error("accountId is required");
  }
  return { id: obj.id, accountId: obj.accountId };
}

export function validateUpdateCollection(
  payload: unknown,
): UpdateCollectionPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Collection payload must be an object");
  }
  const obj = payload as Record<string, unknown>;
  const data = sanitize(obj, UPDATE_FIELDS);
  if (Object.keys(data).length === 0) {
    throw new Error("No valid collection fields to update");
  }
  if (data.name !== undefined) {
    if (typeof data.name !== "string" || !data.name.trim()) {
      throw new Error("Collection name cannot be empty");
    }
    data.name = data.name.trim();
  }
  if (
    data.icon !== undefined &&
    data.icon !== null &&
    typeof data.icon !== "string"
  ) {
    throw new Error("Collection icon must be a string or null");
  }
  return data as UpdateCollectionPayload;
}

export function validateAddCollectionSource(
  payload: unknown,
): AddCollectionSourcePayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Collection source payload must be an object");
  }
  const obj = payload as Record<string, unknown>;
  if (typeof obj.accountId !== "string" || !obj.accountId.trim()) {
    throw new Error("accountId is required");
  }
  if (typeof obj.collectionId !== "string" || !obj.collectionId.trim()) {
    throw new Error("collectionId is required");
  }
  if (
    typeof obj.name !== "string" ||
    !obj.name.trim() ||
    obj.name.trim().length > MAX_SOURCE_NAME_LENGTH ||
    Array.from(obj.name).some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error("Collection source name is invalid");
  }

  const base = {
    accountId: obj.accountId,
    collectionId: obj.collectionId,
    name: obj.name.trim(),
  };
  if (obj.kind === "file") {
    if (typeof obj.data !== "string") {
      throw new Error("Collection source data is required");
    }
    if (typeof obj.mimeType !== "string" || !obj.mimeType.trim()) {
      throw new Error("Collection source MIME type is required");
    }
    return {
      ...base,
      kind: "file",
      mimeType: obj.mimeType.trim(),
      data: obj.data,
    };
  }
  if (obj.kind === "text") {
    if (typeof obj.text !== "string" || !obj.text.trim()) {
      throw new Error("Collection source text is required");
    }
    if (Buffer.byteLength(obj.text, "utf8") > MAX_TEXT_SOURCE_BYTES) {
      throw new Error("Collection source text is too large");
    }
    return { ...base, kind: "text", text: obj.text };
  }
  throw new Error("Collection source kind must be file or text");
}
