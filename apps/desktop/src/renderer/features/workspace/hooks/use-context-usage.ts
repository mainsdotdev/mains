import { useEffect, useRef, useState } from "react";
import { appEvents } from "@/lib/transport";

export interface ContextUsageCategory {
  name: string;
  tokens: number;
  kind: "used" | "free" | "buffer" | "deferred";
  /**
   * Categorical slot for a `used` row — assigned on first sight and held for
   * the life of the run, so a category keeps its color as the run grows.
   * Deriving it from the row's position or size instead would repaint every
   * other category whenever one grew past another.
   *
   * -1 for rows that carry no identity color (free space, compaction buffer,
   * deferred schemas).
   */
  slot: number;
}

export interface ContextUsageSnapshot {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  model?: string;
  isAutoCompactEnabled?: boolean;
  autoCompactThreshold?: number;
  categories?: ContextUsageCategory[];
  ts: number;
}

/**
 * Subscribes to live context-window usage snapshots for the active run.
 * Snapshots are ephemeral (pushed as the turn advances, never persisted), so the
 * hook holds the most recent one in local state and clears it when the active
 * run changes.
 */
export function useContextUsage(activeRunId: string | null): ContextUsageSnapshot | null {
  const [usageByRun, setUsageByRun] = useState<{
    runId: string;
    snapshot: ContextUsageSnapshot;
  } | null>(null);
  const slotsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!activeRunId) return;

    // Slots belong to one run's vocabulary of categories; a new run starts over.
    slotsRef.current = new Map();

    const cleanup = appEvents.runs.onContextUsage((data) => {
      if (data.runId !== activeRunId) return;
      const { event } = data;
      const categories = event.categories?.map((category) => {
        if (category.kind !== "used") return { ...category, slot: -1 };
        const slots = slotsRef.current;
        let slot = slots.get(category.name);
        if (slot === undefined) {
          slot = slots.size;
          slots.set(category.name, slot);
        }
        return { ...category, slot };
      });

      setUsageByRun({
        runId: activeRunId,
        snapshot: {
          totalTokens: event.totalTokens,
          maxTokens: event.maxTokens,
          percentage: event.percentage,
          model: event.model,
          isAutoCompactEnabled: event.isAutoCompactEnabled,
          autoCompactThreshold: event.autoCompactThreshold,
          categories,
          ts: event.ts ?? Date.now(),
        },
      });
    });

    return () => {
      cleanup();
    };
  }, [activeRunId]);

  if (!activeRunId || usageByRun?.runId !== activeRunId) {
    return null;
  }

  return usageByRun.snapshot;
}
