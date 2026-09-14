import fs from "node:fs";
import path from "node:path";
import type {
  RunExecutionContext,
  WorkRunContextItem,
} from "../../../shared/adapter.types";
import { collectionsService } from "../collections";
import { runsRepo } from "./runs.repo";

function safeDisplayName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base : "source";
}

function assertSafeIdentity(value: string, label: string): void {
  if (!value || value === "." || value === ".." || /[\\/]/.test(value)) {
    throw new Error(`Invalid ${label} for Collection Source projection`);
  }
}

/**
 * Snapshot the Collection's current canonical Sources into this run's managed
 * execution tree. Existing snapshots are retained, so moving a run changes
 * future context without rewriting its history.
 */
export async function materializeCollectionSourceContext(args: {
  runId: string;
  accountId: string;
  collectionId: string | null | undefined;
  execution: RunExecutionContext;
}): Promise<WorkRunContextItem[]> {
  if (!args.collectionId) return [];
  assertSafeIdentity(args.runId, "run id");

  const [sources, existingContext] = await Promise.all([
    collectionsService.getSourceMaterials({
      accountId: args.accountId,
      collectionId: args.collectionId,
    }),
    runsRepo.findContextByRun(args.runId),
  ]);
  const recorded = new Set(
    existingContext
      .filter((item) => item.metadata?.origin === "collection-source")
      .map(
        (item) =>
          `${String(item.metadata?.collectionSourceId)}:${item.contentHash ?? ""}`,
      ),
  );

  const context: WorkRunContextItem[] = [];
  for (const source of sources) {
    assertSafeIdentity(source.id, "source id");
    const destination = path.join(
      args.execution.cwd,
      ".mains",
      "runs",
      args.runId,
      "sources",
      source.id,
      safeDisplayName(source.name),
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source.absolutePath, destination);

    const content =
      `Project Source "${source.name}" is available at ${destination}. ` +
      "Treat it as reference context; do not modify the canonical source.";
    const metadata = {
      origin: "collection-source",
      collectionId: source.collectionId,
      collectionSourceId: source.id,
      mimeType: source.mimeType,
      byteSize: source.byteSize,
    };
    context.push({ kind: "file", ref: destination, content, metadata });

    const key = `${source.id}:${source.contentHash}`;
    if (!recorded.has(key)) {
      await runsRepo.insertContext({
        runId: args.runId,
        kind: "file",
        ref: destination,
        content,
        contentHash: source.contentHash,
        metadata,
      });
    }
  }
  return context;
}
