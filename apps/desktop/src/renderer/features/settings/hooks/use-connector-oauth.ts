import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectorOAuthLoginCompletion } from "@mains/contracts/provider-connectors";
import { toast } from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { useStartProviderConnectorOAuthMutation } from "@/lib/redux/api";
import { appEvents } from "@/lib/transport/events";

interface PendingLogin {
  providerId: string;
  serverName: string;
  loginId?: string;
  responseReceived: boolean;
  earlyCompletions: Map<string | undefined, ConnectorOAuthLoginCompletion>;
}

/** Keep each connector pending until its own native OAuth attempt completes. */
export function useConnectorOAuth(providerId: string) {
  const [startConnectorOAuth] = useStartProviderConnectorOAuthMutation();
  const pending = useRef(new Map<string, PendingLogin>());
  const [waiting, setWaiting] = useState({ providerId, servers: new Set<string>() });

  const finish = useCallback((attempt: PendingLogin, completion: ConnectorOAuthLoginCompletion) => {
    if (pending.current.get(attempt.serverName) !== attempt) return;
    pending.current.delete(attempt.serverName);
    setWaiting((current) => {
      if (current.providerId !== attempt.providerId) return current;
      const servers = new Set(current.servers);
      servers.delete(attempt.serverName);
      return { ...current, servers };
    });
    if (!completion.success) toast.error(completion.error || "Connector login failed");
  }, []);

  useEffect(() => {
    const attempts = pending.current;
    const off = appEvents.providers.onConnectorsUpdated(({ providerId: changedId, oauthLogin }) => {
      if (changedId !== providerId || !oauthLogin) return;
      const attempt = attempts.get(oauthLogin.serverName);
      if (!attempt || attempt.providerId !== providerId) return;
      // Completion can arrive before the RPC response supplies its loginId.
      if (!attempt.responseReceived) {
        attempt.earlyCompletions.set(oauthLogin.loginId, oauthLogin);
      } else if (!attempt.loginId || attempt.loginId === oauthLogin.loginId) {
        finish(attempt, oauthLogin);
      }
    });
    return () => {
      off();
      for (const [name, attempt] of attempts) {
        if (attempt.providerId === providerId) attempts.delete(name);
      }
    };
  }, [providerId, finish]);

  const startLogin = useCallback(async (serverName: string) => {
    if (pending.current.has(serverName)) return;
    const attempt: PendingLogin = {
      providerId, serverName, responseReceived: false, earlyCompletions: new Map(),
    };
    pending.current.set(serverName, attempt);
    setWaiting((current) => ({
      providerId,
      servers: new Set([...(current.providerId === providerId ? current.servers : []), serverName]),
    }));
    try {
      const result = await startConnectorOAuth({ providerId, serverName }).unwrap();
      if (pending.current.get(serverName) !== attempt) return;
      attempt.loginId = result.loginId;
      attempt.responseReceived = true;
      // Older runtimes have no loginId; correlate those completions by server.
      const early = result.loginId
        ? attempt.earlyCompletions.get(result.loginId)
        : [...attempt.earlyCompletions.values()].at(-1);
      attempt.earlyCompletions.clear();
      if (early) {
        finish(attempt, early);
        return;
      }
      const opened = await window.api.shell.openExternal(result.authorizationUrl);
      if (opened?.success === false) throw new Error(opened.error);
    } catch (error) {
      finish(attempt, {
        serverName, success: false,
        error: extractErrorMessage(error, "Failed to start connector login"),
      });
    }
  }, [providerId, startConnectorOAuth, finish]);

  return {
    startLogin,
    isPending: (serverName: string) => waiting.providerId === providerId && waiting.servers.has(serverName),
  };
}
