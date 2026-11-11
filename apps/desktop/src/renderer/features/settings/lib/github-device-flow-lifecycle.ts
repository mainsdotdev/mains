import type { GitHubDeviceAuthorization, GitHubDevicePollResult } from "@/lib/redux/api/connectionsApi";

export interface GitHubDeviceFlowState {
  phase: "idle" | "starting" | "waiting" | "polling" | "submitting" | "retired";
  auth: GitHubDeviceAuthorization | null;
  error: string;
}
export const idleGitHubDeviceFlow: GitHubDeviceFlowState = { phase: "idle", auth: null, error: "" };

/** One mounted credential pane owns acquisition, polling and token handoff. */
export function createGitHubDeviceFlowLifecycle(effects: {
  start(): Promise<GitHubDeviceAuthorization>;
  poll(code: string): Promise<GitHubDevicePollResult>;
  open(url: string): unknown;
  onToken(token: string): Promise<void>;
  change(state: GitHubDeviceFlowState): void;
  error(error: unknown, fallback: string): string;
  isCurrent(): boolean;
}) {
  let retired = false;
  let attempt: object | null = null;
  let state = idleGitHubDeviceFlow;
  const publish = (next: GitHubDeviceFlowState) => { state = next; effects.change(next); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const current = (ticket: object) => {
    if (retired || attempt !== ticket) return false;
    if (!effects.isCurrent()) { close(true); return false; }
    return true;
  };
  const clear = () => { clearTimeout(timer); clearTimeout(expiry); timer = expiry = undefined; };
  const finish = (ticket: object, error = "") => {
    if (!current(ticket)) return;
    clear(); attempt = null;
    publish({ ...idleGitHubDeviceFlow, error });
  };
  const close = (notify: boolean) => {
    if (retired) return;
    retired = true; clear(); attempt = null;
    if (notify) publish({ phase: "retired", auth: null, error: "This connection dialog changed. Reopen it to continue." });
  };
  const openBrowser = () => {
    const ticket = attempt;
    const url = state.auth?.verificationUri;
    if (!ticket || !url || !current(ticket)) return;
    void Promise.resolve().then(() => {
      if (current(ticket)) return effects.open(url);
      return undefined;
    }).catch((error) => {
      if (current(ticket)) publish({ ...state, error: effects.error(error, "Could not open GitHub. Use Open GitHub to retry.") });
    });
  };
  return {
    openBrowser,
    cancel() { clear(); attempt = null; if (!retired) publish(idleGitHubDeviceFlow); },
    close() { close(false); },
    retire() { close(true); },
    async start() {
      if (retired || attempt) return;
      if (!effects.isCurrent()) { close(true); return; }
      const ticket = {}; attempt = ticket;
      const requestedAt = Date.now();
      publish({ phase: "starting", auth: null, error: "" });
      try {
        const auth = await effects.start();
        if (!current(ticket)) return;
        const expiresAt = requestedAt + auth.expiresIn * 1000;
        const expire = () => finish(ticket, "The sign-in code expired. Start again.");
        if (Date.now() >= expiresAt) { expire(); return; }
        expiry = setTimeout(expire, expiresAt - Date.now());
        publish({ phase: "waiting", auth, error: "" });
        openBrowser();
        let intervalMs = Math.max(auth.interval, 1) * 1000;
        const tick = async () => {
          if (!current(ticket)) return;
          if (Date.now() >= expiresAt) { expire(); return; }
          publish({ phase: "polling", auth, error: "" });
          try {
            const result = await effects.poll(auth.deviceCode);
            if (!current(ticket)) return;
            if (Date.now() >= expiresAt) { expire(); return; }
            if (result.status === "success") {
              clear();
              publish({ phase: "submitting", auth: null, error: "" });
              await effects.onToken(result.token);
              finish(ticket); return;
            }
            if (result.status === "expired") { finish(ticket, "The sign-in code expired. Start again."); return; }
            if (result.status === "denied") { finish(ticket, "Sign-in was declined on GitHub."); return; }
            if (result.status === "slow_down") {
              const advised = Number.isFinite(result.interval) ? result.interval * 1000 : 0;
              intervalMs = Math.max(intervalMs + 5000, advised);
            }
            publish({ phase: "waiting", auth, error: "" });
            timer = setTimeout(() => { void tick(); }, intervalMs);
          } catch (error) { finish(ticket, effects.error(error, "GitHub sign-in failed")); }
        };
        timer = setTimeout(() => { void tick(); }, intervalMs);
      } catch (error) { finish(ticket, effects.error(error, "Could not start GitHub sign-in")); }
    },
  };
}
