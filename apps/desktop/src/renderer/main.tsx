// Must be first: in a browser (no Electron preload) this installs the window.api
// shim and points the transport at the backend over WebSocket, before any app
// module loads. No-op under Electron. See docs/design/remote-backend.md.
import "./lib/platform/web-bootstrap";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { markAppReady } from "./lib/app-ready";
import "./index.css";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Keep animations disabled (see the `.app-ready` gate in index.css) until the
// launch churn has actually settled, not just until the first paint: fonts
// swapped in AND the main thread has real idle time after the initial
// mount/query storm. Both signals are time-bounded so the gate cannot wedge —
// worst case it opens ~2.5s after boot.
const fontsReady: Promise<unknown> =
  document.fonts?.ready ?? Promise.resolve();
const mainThreadIdle = new Promise<void>((resolve) => {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => resolve(), { timeout: 2500 });
  } else {
    window.setTimeout(resolve, 1500);
  }
});
Promise.all([fontsReady, mainThreadIdle]).then(() => {
  // Let one more full frame composite before enabling animations.
  requestAnimationFrame(() => {
    requestAnimationFrame(markAppReady);
  });
});
