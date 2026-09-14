import { getTransport } from "../transport";
import type { ServiceResponse } from "../../../shared/ipc-kit/service-response";

/**
 * In a browser there is no Electron preload, so `window.api` is missing. This
 * installs a shim that makes the existing renderer run unchanged against a remote
 * backend over WebSocket:
 *
 *  - Backend namespaces → every `window.api.<ns>.<method>(...args)` is forwarded
 *    to the active transport as `invoke("<ns>:<method>", args)`. (RTK Query,
 *    appApi and appEvents already go through the transport directly; this covers
 *    any remaining direct calls.)
 *  - Local-shell namespaces (shell/platform/app/browser/updates/imageProxy/
 *    documents) act on the user's machine and have no browser equivalent, so they
 *    are stubbed: methods resolve to a benign value, `on*` subscriptions are
 *    no-ops, and `shell.openExternal` opens a new tab.
 *
 * See docs/design/remote-backend.md (web client).
 */

const LOCAL_NAMESPACES = new Set([
  "shell",
  "platform",
  "app",
  "browser",
  "updates",
  "imageProxy",
  "documents",
]);

const okResponse: ServiceResponse<null> = { success: true, data: null };
// Local-shell calls return a failure so consumers that check `result.success`
// (the standard pattern) keep their defaults instead of consuming a null payload
// and crashing (e.g. reading `.status` off a null update state).
const unavailableResponse: ServiceResponse<null> = {
  success: false,
  error: "Unavailable in web mode",
};

function isEventMethod(name: string): boolean {
  return /^on[A-Z]/.test(name);
}

function localStub(ns: string, method: string): unknown {
  // platform.homedir is a value, not a function.
  if (ns === "platform" && method === "homedir") return "";
  if (isEventMethod(method)) return () => () => {};
  if (ns === "shell" && method === "openExternal") {
    return (url: string) => {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* ignore */
      }
      return Promise.resolve(okResponse);
    };
  }
  return (..._args: unknown[]) => Promise.resolve(unavailableResponse);
}

function namespaceProxy(ns: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        if (LOCAL_NAMESPACES.has(ns)) return localStub(ns, prop);
        // Backend events are delivered via appEvents (transport.subscribe); a
        // stray direct `on*` here is a no-op.
        if (isEventMethod(prop)) return () => () => {};
        return (...args: unknown[]) =>
          getTransport().invoke(`${ns}:${prop}`, args);
      },
    },
  );
}

/** Install the `window.api` shim. Call once, before the app renders. */
export function installWebApi(): void {
  const nsCache = new Map<string, unknown>();
  const api = new Proxy(
    {},
    {
      get(_target, ns) {
        if (typeof ns !== "string") return undefined;
        let proxy = nsCache.get(ns);
        if (!proxy) {
          proxy = namespaceProxy(ns);
          nsCache.set(ns, proxy);
        }
        return proxy;
      },
    },
  );
  (window as unknown as { api: unknown }).api = api;
}
