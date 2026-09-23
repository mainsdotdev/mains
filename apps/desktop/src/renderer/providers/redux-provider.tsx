import { persistor, store } from "@/lib/redux";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { useEffect } from "react";
import { useAppSelector } from "@/lib/redux/hooks";
import { getTransport } from "@/lib/transport";
import { reconcilePersistedUiState } from "@/lib/redux/ui-state-reconciliation";

interface ReduxProviderProps {
  children: ReactNode;
}

function UiStateReconciler({ children }: ReduxProviderProps) {
  const backendId = useAppSelector((state) => state.backends.activeBackendId) ?? "local";
  useEffect(() => {
    const transport = getTransport();
    const check = () => {
      if (transport.status() === "connected") {
        void reconcilePersistedUiState(store.dispatch, store.getState, transport, backendId);
      }
    };
    check();
    return transport.onStatusChange(check);
  }, [backendId]);
  return <>{children}</>;
}

export function ReduxProvider({ children }: ReduxProviderProps) {
  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <UiStateReconciler>{children}</UiStateReconciler>
      </PersistGate>
    </Provider>
  );
}
