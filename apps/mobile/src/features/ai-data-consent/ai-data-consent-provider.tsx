import { useRouter, type Href } from "expo-router";
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  aiProviderDisclosure,
  grantAiDataConsent,
  hasAiDataConsent,
  type AiProviderDisclosure,
} from "@/lib/ai-data-consent";
import { DEMO_BACKEND_ID } from "@/backend/demo/transport";

export interface PendingAiDataConsent {
  backendId: string;
  disclosure: AiProviderDisclosure;
  /** Demo Mode exercises the disclosure UI but sends nothing off-device. */
  isDemo: boolean;
}

interface ActiveRequest {
  key: string;
  pending: PendingAiDataConsent;
  promise: Promise<boolean>;
  resolve: (allowed: boolean) => void;
}

interface AiDataConsentContextValue {
  pending: PendingAiDataConsent | null;
  requestConsent: (backendId: string, providerId: string) => Promise<boolean>;
  allowPending: () => void;
  declinePending: () => void;
}

const AiDataConsentContext = createContext<AiDataConsentContextValue | null>(null);

/**
 * Coordinates a native consent sheet with the send action waiting underneath
 * it. Only one request can be visible; repeated taps for the same provider
 * share its promise instead of stacking sheets.
 */
export function AiDataConsentProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const activeRef = useRef<ActiveRequest | null>(null);
  const seenDemoDisclosuresRef = useRef(new Set<string>());
  const [pending, setPending] = useState<PendingAiDataConsent | null>(null);

  const settle = useCallback((allowed: boolean) => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    setPending(null);
    active.resolve(allowed);
  }, []);

  const requestConsent = useCallback(
    (backendId: string, providerId: string): Promise<boolean> => {
      const key = `${backendId}:${providerId}`;
      const isDemo = backendId === DEMO_BACKEND_ID;
      if (
        (isDemo && seenDemoDisclosuresRef.current.has(key)) ||
        (!isDemo && hasAiDataConsent(backendId, providerId))
      ) {
        return Promise.resolve(true);
      }

      const disclosure = aiProviderDisclosure(providerId);
      if (!disclosure) {
        return Promise.reject(
          new Error(`Mains has no data-sharing disclosure for provider “${providerId}”.`),
        );
      }

      const active = activeRef.current;
      if (active) {
        return active.key === key ? active.promise : Promise.resolve(false);
      }

      const nextPending = { backendId, disclosure, isDemo };
      let resolveRequest: (allowed: boolean) => void = () => {};
      const promise = new Promise<boolean>((resolve) => {
        resolveRequest = resolve;
      });
      activeRef.current = {
        key,
        pending: nextPending,
        promise,
        resolve: resolveRequest,
      };
      setPending(nextPending);
      router.push("/ai-data-consent" as Href);
      return promise;
    },
    [router],
  );

  const allowPending = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    if (active.pending.isDemo) {
      seenDemoDisclosuresRef.current.add(active.key);
    } else {
      grantAiDataConsent(
        active.pending.backendId,
        active.pending.disclosure.providerId,
      );
    }
    settle(true);
  }, [settle]);

  const value = useMemo<AiDataConsentContextValue>(
    () => ({
      pending,
      requestConsent,
      allowPending,
      declinePending: () => settle(false),
    }),
    [allowPending, pending, requestConsent, settle],
  );

  return <AiDataConsentContext value={value}>{children}</AiDataConsentContext>;
}

export function useAiDataConsent(): AiDataConsentContextValue {
  const context = use(AiDataConsentContext);
  if (!context) {
    throw new Error("useAiDataConsent must be used inside AiDataConsentProvider");
  }
  return context;
}
