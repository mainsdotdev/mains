import { setTransport, WsTransport } from "@/lib/transport";
import { isWeb } from "./platform";
import { installWebApi } from "./web-api-shim";
import { exchangeWebLogin, takeWebLoginCode } from "./web-login";

/**
 * Web-mode bootstrap. Imported FIRST in main.tsx so it runs before any app
 * module touches `window.api`.
 *
 * Under Electron this is a no-op. In a plain browser (the renderer served by
 * `mains serve` over HTTP) there is no preload: install the `window.api` shim and
 * connect to the backend that served this page (same origin) over WebSocket. A
 * single-use `#login=` code is removed before the router starts and exchanged
 * for HttpOnly cookies; the owner token never enters browser JavaScript.
 *
 * See docs/design/remote-backend.md (web client).
 */
if (isWeb && typeof window !== "undefined") {
  // Mark the document so CSS can paint a solid background (the page isn't a
  // transparent Electron window; without this the window translucency renders as
  // a washed-out white in a browser). See index.css `.mains-web`.
  document.documentElement.classList.add("mains-web");

  installWebApi();

  const loginCode = takeWebLoginCode();

  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${scheme}//${window.location.host}/__mains/ws`;
  const transport = new WsTransport(wsUrl);
  setTransport(transport);
  // Invokes issued during the one-time exchange wait in the transport outbox.
  // Existing sessions have no code and connect immediately with their cookie.
  void exchangeWebLogin(loginCode)
    .catch(() => {
      /* the transport's normal offline state communicates an expired link */
    })
    .finally(() => transport.connect());
}
