import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export interface StagedCollectionStorageRemoval {
  commit(): void;
  restore(): void;
}

function userDataRoot(): string {
  return app?.getPath("userData") || path.join(process.cwd(), ".data");
}

function assertStorageId(value: string, label: string): void {
  if (!value || value === "." || value === ".." || /[\\/]/.test(value)) {
    throw new Error(`Invalid ${label} for managed Collection storage`);
  }
}

function collectionsRoot(): string {
  return path.join(userDataRoot(), "collections");
}

function collectionRoot(collectionId: string): string {
  assertStorageId(collectionId, "collection id");
  return path.join(collectionsRoot(), collectionId);
}

function safeExtension(name: string): string {
  const extension = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : "";
}

function relativeStorageKey(absolutePath: string): string {
  return path.relative(userDataRoot(), absolutePath).split(path.sep).join("/");
}

export function collectionSourceStoragePath(args: {
  collectionId: string;
  sourceId: string;
  name: string;
}): { absolutePath: string; storageKey: string } {
  assertStorageId(args.sourceId, "source id");
  const absolutePath = path.join(
    collectionRoot(args.collectionId),
    "sources",
    args.sourceId,
    `content${safeExtension(args.name)}`,
  );
  return { absolutePath, storageKey: relativeStorageKey(absolutePath) };
}

export function resolveCollectionSourceStorage(args: {
  collectionId: string;
  sourceId: string;
  name: string;
  storageKey: string;
}): string {
  const expected = collectionSourceStoragePath(args);
  if (args.storageKey !== expected.storageKey) {
    throw new Error("Collection source storage metadata is invalid");
  }
  return expected.absolutePath;
}

export function writeCollectionSource(args: {
  collectionId: string;
  sourceId: string;
  name: string;
  bytes: Buffer;
}): string {
  const { absolutePath, storageKey } = collectionSourceStoragePath(args);
  const directory = path.dirname(absolutePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.pending-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(temporaryPath, args.bytes, { flag: "wx" });
    fs.renameSync(temporaryPath, absolutePath);
    return storageKey;
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function removeCollectionSourceStorage(args: {
  collectionId: string;
  sourceId: string;
}): void {
  assertStorageId(args.sourceId, "source id");
  fs.rmSync(
    path.join(collectionRoot(args.collectionId), "sources", args.sourceId),
    { recursive: true, force: true },
  );
}

export function stageCollectionSourceStorageRemoval(args: {
  collectionId: string;
  sourceId: string;
}): StagedCollectionStorageRemoval {
  assertStorageId(args.sourceId, "source id");
  const source = path.join(
    collectionRoot(args.collectionId),
    "sources",
    args.sourceId,
  );
  if (!fs.existsSync(source)) return { commit() {}, restore() {} };

  const trashRoot = path.join(collectionsRoot(), ".trash");
  fs.mkdirSync(trashRoot, { recursive: true });
  const staged = path.join(
    trashRoot,
    `source-${args.sourceId}-${crypto.randomUUID()}`,
  );
  fs.renameSync(source, staged);
  let settled = false;
  return {
    commit() {
      if (settled) return;
      settled = true;
      fs.rmSync(staged, { recursive: true, force: true });
    },
    restore() {
      if (settled) return;
      settled = true;
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.renameSync(staged, source);
    },
  };
}

/**
 * Move a Collection's managed directory aside before deleting its row. The
 * caller can restore the directory when the database mutation fails, so the
 * filesystem and database do not drift on the ordinary failure path.
 */
export function stageCollectionStorageRemoval(
  collectionId: string,
): StagedCollectionStorageRemoval {
  const source = collectionRoot(collectionId);
  if (!fs.existsSync(source)) {
    return { commit() {}, restore() {} };
  }

  const trashRoot = path.join(collectionsRoot(), ".trash");
  fs.mkdirSync(trashRoot, { recursive: true });
  const staged = path.join(trashRoot, `${collectionId}-${crypto.randomUUID()}`);
  fs.renameSync(source, staged);
  let settled = false;

  return {
    commit() {
      if (settled) return;
      settled = true;
      fs.rmSync(staged, { recursive: true, force: true });
    },
    restore() {
      if (settled) return;
      settled = true;
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.renameSync(staged, source);
    },
  };
}
