import { useCallback, useEffect, useRef, useState } from "react";
import { appEvents } from "@/lib/transport";
import {
  useLazyGetProviderGoalQuery,
  useSetProviderGoalMutation,
  useClearProviderGoalMutation,
  type GoalInfo,
} from "@/lib/redux/api/providersApi";

/**
 * Live state + controls for a Codex run's thread goal. Backs the goal card
 * above the input. Pulls the current goal once on mount (covers UI reopened
 * mid-goal) and then tracks the `providers:goalUpdated` push for live
 * status/usage. Returns no-op-safe controls keyed to the active run.
 *
 * `enabled` should be false for non-Codex variants so we don't subscribe or
 * fetch where goals don't exist.
 */
export function useCodexGoal(
  providerId: string,
  runId: string | undefined,
  enabled: boolean,
) {
  // Store the goal alongside the runId it belongs to, so switching runs never
  // flashes a previous run's goal and we avoid synchronous setState in effects.
  const [entry, setEntry] = useState<{ runId: string; goal: GoalInfo | null } | null>(null);
  const [fetchGoal] = useLazyGetProviderGoalQuery();
  const [setGoalMut, { isLoading: isSetting }] = useSetProviderGoalMutation();
  const [clearGoalMut, { isLoading: isClearing }] = useClearProviderGoalMutation();

  // Initial pull when the active run changes.
  useEffect(() => {
    if (!enabled || !runId) return;
    let cancelled = false;
    fetchGoal({ providerId, runId })
      .unwrap()
      .then((g) => {
        if (!cancelled) setEntry({ runId, goal: g ?? null });
      })
      .catch(() => {
        /* no goal / server down — leave as-is */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, providerId, runId, fetchGoal]);

  // Live updates (set / status / usage / cleared).
  useEffect(() => {
    if (!enabled || !runId) return;
    const off = appEvents.providers.onGoalUpdated(({ providerId: pid, runId: rid, goal: g }) => {
      if (pid !== providerId) return;
      // null runId on the event = couldn't reverse-map thread; accept it.
      if (rid && rid !== runId) return;
      setEntry({ runId, goal: (g as GoalInfo | null) ?? null });
    });
    return () => {
      off();
    };
  }, [enabled, providerId, runId]);

  const updateObjective = useCallback(
    async (objective: string) => {
      if (!runId || !objective.trim()) return;
      const g = await setGoalMut({ providerId, runId, params: { objective } })
        .unwrap()
        .catch(() => null);
      if (g) setEntry({ runId, goal: g });
    },
    [providerId, runId, setGoalMut],
  );

  const clear = useCallback(async () => {
    if (!runId) return;
    await clearGoalMut({ providerId, runId }).unwrap().catch(() => false);
    setEntry({ runId, goal: null });
  }, [providerId, runId, clearGoalMut]);

  // Flip the goal's status (Codex `thread/goal/set`). pause → "paused" (the run
  // keeps running; only the goal flag changes), resume → "active".
  const setStatus = useCallback(
    async (status: "paused" | "active") => {
      if (!runId) return;
      const g = await setGoalMut({ providerId, runId, params: { status } })
        .unwrap()
        .catch(() => null);
      if (g) setEntry({ runId, goal: g });
    },
    [providerId, runId, setGoalMut],
  );
  const pause = useCallback(() => setStatus("paused"), [setStatus]);
  const resume = useCallback(() => setStatus("active"), [setStatus]);

  const goal = enabled && runId && entry?.runId === runId ? entry.goal : null;

  // When Codex marks the goal complete (`thread/goal/updated` → status
  // "complete"), briefly show the completed state then auto-remove it — the
  // run's chat summary already records "Goal marked complete", so a lingering
  // bar is just noise. Other terminal states (paused/blocked/limited) stay put
  // since they need user attention. Cleared once per run via the ref.
  const autoClearedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!runId || goal?.status !== "complete") return;
    if (autoClearedRef.current === runId) return;
    const t = setTimeout(() => {
      autoClearedRef.current = runId;
      clear();
    }, 3000);
    return () => clearTimeout(t);
  }, [runId, goal?.status, clear]);

  return { goal, updateObjective, clear, pause, resume, isBusy: isSetting || isClearing };
}
