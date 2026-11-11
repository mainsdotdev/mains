import { useLayoutEffect, useRef, useState } from "react";
import { appEvents, getTransport, onTransportChange } from "@/lib/transport";
import {
  useLazyGetProviderGoalQuery, useSetProviderGoalMutation, useClearProviderGoalMutation,
} from "@/lib/redux/api/providersApi";
import {
  createProviderGoalView, emptyProviderGoalView, type ProviderGoalViewState,
} from "@mains/backend/shared/provider-goal-lifecycle";

/** One mounted provider/run/transport scope owns projection, controls and timers. */
export function useCodexGoal(providerId: string, runId: string | undefined, enabled: boolean) {
  const [fetchGoal] = useLazyGetProviderGoalQuery();
  const [setGoal] = useSetProviderGoalMutation();
  const [clearGoal] = useClearProviderGoalMutation();
  const [connection, setConnection] = useState(() => ({ transport: getTransport(), revision: 0 }));
  const input = JSON.stringify([providerId, runId, enabled, connection.revision]);
  const [scope, setScope] = useState({ input, revision: 0 });
  if (scope.input !== input) setScope({ input, revision: scope.revision + 1 });
  const [view, setView] = useState<{ scope: typeof scope; state: ProviderGoalViewState }>({ scope, state: emptyProviderGoalView });
  const owner = useRef<{ scope: typeof scope; life: ReturnType<typeof createProviderGoalView> } | null>(null);

  useLayoutEffect(() => onTransportChange((transport) => {
    owner.current?.life.retire();
    setConnection((previous) => ({ transport, revision: previous.revision + 1 }));
  }), []);
  useLayoutEffect(() => {
    const life = createProviderGoalView({
      current: () => enabled && !!runId && getTransport() === connection.transport,
      read: () => fetchGoal({ providerId, runId: runId! }).unwrap(),
      set: (params) => setGoal({ providerId, runId: runId!, params }).unwrap(),
      clear: (origin) => clearGoal({ providerId, runId: runId!, origin }).unwrap(),
      change: (state) => setView({ scope, state }),
    });
    const entry = { scope, life }; owner.current = entry;
    const off = enabled && runId ? appEvents.providers.onGoalUpdated((event) => {
      if (event.providerId === providerId && event.runId === runId) life.receive(event.goal);
    }) : () => {};
    void life.load();
    return () => { life.retire(); off(); if (owner.current === entry) owner.current = null; };
  }, [scope, connection.transport, providerId, runId, enabled, fetchGoal, setGoal, clearGoal]);

  const act = (action: (life: ReturnType<typeof createProviderGoalView>) => Promise<boolean>) => {
    const current = owner.current;
    return current?.scope === scope ? action(current.life) : Promise.resolve(false);
  };
  const state = enabled && runId && view.scope === scope ? view.state : emptyProviderGoalView;
  return {
    ...state, scopeKey: scope.revision,
    updateObjective: (objective: string) => act((life) => life.edit(objective)),
    clear: () => act((life) => life.clear()),
    pause: () => act((life) => life.pause()),
    resume: () => act((life) => life.resume()),
  };
}
