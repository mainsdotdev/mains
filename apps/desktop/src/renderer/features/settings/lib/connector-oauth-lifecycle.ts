import type {
  ConnectorOAuthLoginCompletion,
  ConnectorOAuthStartResult,
  ProviderConnectorsUpdatedEvent,
} from "@mains/contracts/provider-connectors";
import { extractErrorMessage } from "@/lib/extract-error-message";

type Phase = "starting" | "opening" | "waiting" | "succeeded" | "failed" | "retired";
interface LoginAttempt {
  serverName: string;
  phase: Phase;
  loginId?: string;
  early: Map<string | undefined, ConnectorOAuthLoginCompletion>;
}

/** One provider/transport binding owns its attempts. starting -> opening -> waiting ->
 * succeeded/failed; an early completion waits for the start response's identity.
 * Disposal retires every attempt. Only the current attempt may publish a result
 * or open a browser, including after a failed attempt has been replaced. */
export function createConnectorOAuthLifecycle(options: {
  providerId: string;
  isCurrent(): boolean;
  start(serverName: string): Promise<ConnectorOAuthStartResult>;
  openExternal(url: string): Promise<{ success: boolean; error?: string } | void>;
  changed(): void;
  failed(message: string): void;
}) {
  const attempts = new Map<string, LoginAttempt>();
  let disposed = false;
  const active = () => !disposed && options.isCurrent();
  const owns = (attempt: LoginAttempt) => active() && attempts.get(attempt.serverName) === attempt;

  function finish(attempt: LoginAttempt, completion: ConnectorOAuthLoginCompletion) {
    if (!owns(attempt)) return;
    attempt.phase = completion.success ? "succeeded" : "failed";
    attempt.early.clear();
    attempts.delete(attempt.serverName);
    options.changed();
    if (!completion.success) options.failed(completion.error || "Connector login failed");
  }

  return {
    isPending(serverName: string) { return active() && attempts.has(serverName); },
    async startLogin(serverName: string): Promise<void> {
      if (!active() || attempts.has(serverName)) return;
      const attempt: LoginAttempt = { serverName, phase: "starting", early: new Map() };
      attempts.set(serverName, attempt);
      options.changed();
      try {
        const result = await options.start(serverName);
        if (!owns(attempt)) return;
        attempt.loginId = result.loginId;
        attempt.phase = "opening";
        // Older runtimes omit loginId, so their server identity is the fallback.
        const early = result.loginId
          ? attempt.early.get(result.loginId)
          : [...attempt.early.values()].at(-1);
        attempt.early.clear();
        if (early) { finish(attempt, early); return; }
        const opened = await options.openExternal(result.authorizationUrl);
        if (opened?.success === false) throw new Error(opened.error);
        if (owns(attempt)) attempt.phase = "waiting";
      } catch (error) {
        finish(attempt, {
          serverName, success: false,
          error: extractErrorMessage(error, "Failed to start connector login"),
        });
      }
    },
    receive({ providerId, oauthLogin }: ProviderConnectorsUpdatedEvent) {
      if (!active() || providerId !== options.providerId || !oauthLogin) return;
      const attempt = attempts.get(oauthLogin.serverName);
      if (!attempt) return;
      if (attempt.phase === "starting") {
        if (!attempt.early.has(oauthLogin.loginId)) attempt.early.set(oauthLogin.loginId, oauthLogin);
      } else if (!attempt.loginId || attempt.loginId === oauthLogin.loginId) finish(attempt, oauthLogin);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const attempt of attempts.values()) { attempt.phase = "retired"; attempt.early.clear(); }
      attempts.clear();
    },
  };
}
