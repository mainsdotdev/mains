import { useState, useReducer, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useLazyGetConnectionQuery, useRevokeConnectionMutation } from "@/lib/redux/api";
import { toast } from "@/components/ui";
import { withMinDelay } from "@/lib/with-min-delay";
import { onTransportChange } from "@/lib/transport";
import type { ConnectionWizardLifecycle } from "../../../lib/connection-wizard-lifecycle";

type StepId = "loading" | "setToken" | "add" | "manage";
interface InitState<TData> { initializing: boolean; targetStep: StepId | null; data: Partial<TData> }
export interface UseConnectionModalStateOptions<TData> {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  provider: string;
  appName: string;
  baseData: Partial<TData>;
  fetchSelected: () => Promise<Partial<TData> | null>;
  owner: ConnectionWizardLifecycle;
}

export function useConnectionModalState<TData>({ open, onClose, isConnected, provider, appName, baseData, fetchSelected, owner }: UseConnectionModalStateOptions<TData>) {
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [initState, setInitState] = useReducer(
    (_: InitState<TData>, next: InitState<TData>) => next,
    { initializing: true, targetStep: null, data: {} },
  );
  const [getConnection] = useLazyGetConnectionQuery();
  const [revokeConnection, { isLoading: isRevoking }] = useRevokeConnectionMutation();
  const options = useRef({ baseData, fetchSelected, isConnected });
  useLayoutEffect(() => { options.current = { baseData, fetchSelected, isConnected }; });
  useLayoutEffect(() => {
    if (open) owner.attach();
    const off = onTransportChange(() => owner.retire());
    return () => { off(); owner.detach(); };
  }, [owner, open, provider]);

  useEffect(() => {
    if (!open) return;
    const lease = owner.begin("initialize");
    if (!lease) return;
    const captured = options.current;
    const load = async () => {
      let data = { ...captured.baseData }, targetStep: StepId = "setToken";
      try {
        const connection = await getConnection({ id: provider, scope: owner.scope }).unwrap();
        lease.assertCurrent();
        data = { ...data, connectionId: connection.id, revision: connection.revision };
        if (captured.isConnected && connection.status === "active") {
          const selected = await withMinDelay(captured.fetchSelected(), 600);
          lease.assertCurrent();
          data = { ...data, ...selected }; targetStep = "manage";
        }
      } catch (error) {
        if (!lease.current()) return;
        data = { ...data, errorMessage: error instanceof Error ? error.message : "Could not load this connection. Please retry." };
      } finally {
        if (lease.move(targetStep)) setInitState({ initializing: false, targetStep, data });
        lease.finish();
      }
    };
    void load();
    return () => lease.finish();
  }, [open, provider, getConnection, owner]);

  const handleClose = useCallback(() => {
    owner.retire(); setShowRevokeConfirm(false); onClose();
  }, [owner, onClose]);
  const handleRevoke = useCallback(async () => {
    const lease = owner.begin("revoke");
    if (!lease) return;
    try {
      await revokeConnection(provider).unwrap();
      if (lease.current()) handleClose();
    } catch {
      if (lease.current()) { setShowRevokeConfirm(false); toast.error(`Failed to revoke ${appName} access`); }
    } finally { lease.finish(); }
  }, [owner, revokeConnection, provider, appName, handleClose]);
  return { initState, showRevokeConfirm, setShowRevokeConfirm, handleClose, handleRevoke, isRevoking };
}
