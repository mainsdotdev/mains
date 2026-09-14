import { useState, useReducer, useEffect, useCallback, useRef } from "react";
import { useLazyGetConnectionQuery, useRevokeConnectionMutation } from "@/lib/redux/api";
import { toast } from "@/components/ui";
import { withMinDelay } from "@/lib/with-min-delay";

type StepId = "loading" | "setToken" | "add" | "manage";

interface InitState<TData> {
  initializing: boolean;
  targetStep: StepId | null;
  data: Partial<TData>;
}

export interface UseConnectionModalStateOptions<TData> {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  provider: string;
  appName: string;
  baseData: Partial<TData>;
  /**
   * Fetch the already-selected resources for this provider.
   * Return a partial data object to merge into wizard data, or null to fall
   * back to fetching just the connectionId via getConnection().
   */
  fetchSelected: () => Promise<Partial<TData> | null>;
}

export function useConnectionModalState<TData>({
  open,
  onClose,
  isConnected,
  provider,
  appName,
  baseData,
  fetchSelected,
}: UseConnectionModalStateOptions<TData>) {
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [initState, setInitState] = useReducer(
    (_: InitState<TData>, next: InitState<TData>) => next,
    { initializing: true, targetStep: null, data: {} },
  );

  const [getConnection] = useLazyGetConnectionQuery();
  const [revokeConnection, { isLoading: isRevoking }] = useRevokeConnectionMutation();

  // Use refs so the effect only re-runs when open/isConnected/provider changes,
  // not when the inline callback identity changes on every render ("latest ref" pattern).
  const fetchSelectedRef = useRef(fetchSelected);
  fetchSelectedRef.current = fetchSelected; // eslint-disable-line react-hooks/refs
  const baseDataRef = useRef(baseData);
  baseDataRef.current = baseData; // eslint-disable-line react-hooks/refs

  useEffect(() => {
    if (!open) {
      setInitState({ initializing: true, targetStep: null, data: {} });
      return;
    }

    const load = async () => {
      let finalStep: StepId = "setToken";
      let finalData: Partial<TData> = baseDataRef.current;

      if (isConnected) {
        try {
          await withMinDelay(
            (async () => {
              const selectedData = await fetchSelectedRef.current();

              if (selectedData) {
                finalData = { ...baseDataRef.current, ...selectedData };
                finalStep = "manage";
              } else {
                const connection = await getConnection(provider).unwrap();
                finalData = { ...baseDataRef.current, connectionId: connection.id };
                finalStep = "manage";
              }
            })(),
            600,
          );
        } catch (err) {
          console.error(`[${provider}:loadInitialData]`, err);
          try {
            const connection = await getConnection(provider).unwrap();
            finalData = { ...baseDataRef.current, connectionId: connection.id };
            finalStep = "manage";
          } catch { /* keep defaults */ }
        }
      }

      setInitState({ initializing: false, targetStep: finalStep, data: finalData });
    };

    load();
  }, [open, isConnected, provider, getConnection]);

  const handleClose = useCallback(() => {
    setShowRevokeConfirm(false);
    onClose();
  }, [onClose]);

  const handleRevoke = useCallback(async () => {
    try {
      await revokeConnection(provider).unwrap();
      setShowRevokeConfirm(false);
      handleClose();
    } catch (err) {
      console.error(`[${provider}:handleRevoke]`, err);
      setShowRevokeConfirm(false);
      toast.error(`Failed to revoke ${appName} access`);
    }
  }, [revokeConnection, provider, appName, handleClose]);

  return {
    initState,
    showRevokeConfirm,
    setShowRevokeConfirm,
    handleClose,
    handleRevoke,
    isRevoking,
  };
}
