import * as fs from "fs";
import * as path from "path";
import { verifySignedPath } from "./imageProxy.signing";

export const MAX_VISUALIZATION_SIZE = 1024 * 1024;

const DOCUMENT_MARKUP = /<!doctype\b|<\s*\/?\s*(?:html|head|body)\b/i;

const ALLOWED_CDNS = [
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
];

export const VISUALIZATION_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: ${ALLOWED_CDNS.join(" ")}`,
  `style-src 'unsafe-inline' https://fonts.googleapis.com https://fonts.bunny.net`,
  `img-src data: blob: ${ALLOWED_CDNS.join(" ")}`,
  "font-src data: https://fonts.gstatic.com https://fonts.bunny.net",
  "connect-src 'none'",
  `media-src data: blob: ${ALLOWED_CDNS.join(" ")}`,
  "worker-src blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// Mains-owned implementation of the public visualization style contract. It
// intentionally stays compact: fragments own their visualization-specific
// layout, while these classes provide consistent controls, cards, typography,
// tables, and semantic colour tokens in both app themes.
const VISUALIZATION_BASE_CSS = String.raw`
:root {
  --background: transparent;
  --foreground: #18181b;
  --card: #ffffff;
  --card-foreground: #18181b;
  --muted: #f4f4f5;
  --muted-foreground: #71717a;
  --border: #d4d4d8;
  --input: #e4e4e7;
  --primary: #18181b;
  --primary-foreground: #fafafa;
  --secondary: #f4f4f5;
  --secondary-foreground: #27272a;
  --accent: #2563eb;
  --accent-foreground: #ffffff;
  --destructive: #dc2626;
  --ring: #3b82f6;
  --radius: 10px;
  --font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Consolas, monospace;
  --blue: #2563eb;
  --green: #16a34a;
  --yellow: #ca8a04;
  --orange: #ea580c;
  --red: #dc2626;
  --purple: #7c3aed;
  --viz-series-1: #2563eb;
  --viz-series-2: #eab308;
  --viz-series-3: #c026d3;
  --viz-series-4: #16a34a;
  --viz-series-5: #7c3aed;
  --viz-series-6: #ea580c;
  --viz-bg: var(--background);
  --viz-panel: var(--card);
  --viz-border: var(--border);
  --viz-text: var(--foreground);
  --viz-muted: var(--muted-foreground);
  --viz-accent: var(--accent);
  --viz-accent-bg: color-mix(in srgb, var(--accent) 12%, transparent);
  --viz-accent-text: var(--accent);
  --viz-warning: var(--orange);
}

:root[data-theme="dark"] {
  --foreground: #f4f4f5;
  --card: #18181b;
  --card-foreground: #f4f4f5;
  --muted: #27272a;
  --muted-foreground: #a1a1aa;
  --border: #3f3f46;
  --input: #3f3f46;
  --primary: #fafafa;
  --primary-foreground: #18181b;
  --secondary: #27272a;
  --secondary-foreground: #f4f4f5;
  --accent: #60a5fa;
  --accent-foreground: #172554;
  --destructive: #f87171;
  --ring: #60a5fa;
  --viz-series-1: #3b82f6;
  --viz-series-2: #fde047;
  --viz-series-3: #d16ba5;
  --viz-series-4: #4ade80;
  --viz-series-5: #a78bfa;
  --viz-series-6: #fb923c;
  --blue: #60a5fa;
  --green: #4ade80;
  --yellow: #fde047;
  --orange: #fb923c;
  --red: #f87171;
  --purple: #a78bfa;
}

/* A root-level color-scheme gives Chromium's embedded document canvas an
   opaque UA background. Scope it to body so native controls stay themed while
   the iframe remains transparent against the transcript surface. */
:root[data-theme="light"] body { color-scheme: light; }
:root[data-theme="dark"] body { color-scheme: dark; }

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; min-width: 0; background: transparent; }
body {
  overflow: hidden;
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.45;
  text-rendering: optimizeLegibility;
}
button, input, select, textarea { font: inherit; }
button, select, input[type="range"], input[type="checkbox"] { cursor: pointer; }
button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .55; }
a { color: var(--accent); }
h1, h2, h3, p { margin-top: 0; }
h1 { font-size: 20px; line-height: 1.2; font-weight: 500; }
h2 { font-size: 17px; line-height: 1.3; font-weight: 500; }
h3 { font-size: 14px; line-height: 1.35; font-weight: 500; }
strong, b { font-weight: 500; }
canvas, svg, img { max-width: 100%; }

#mains-visualization-root { width: 100%; min-width: 0; }
.viz-controls, .viz-row { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
.viz-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.card, .viz-tile, .viz-stat {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--card) 94%, transparent);
  color: var(--card-foreground);
  padding: 12px;
}
.viz-stat { display: grid; gap: 3px; }
.viz-stat-value { font-size: 22px; line-height: 1.15; font-weight: 500; font-variant-numeric: tabular-nums; }
.viz-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--secondary);
  color: var(--secondary-foreground);
  font-size: 12px;
}

.btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--card);
  color: var(--foreground);
  font-weight: 500;
  line-height: 1;
  transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
}
.btn:hover { background: var(--muted); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible, .form-control:focus-visible, .form-select:focus-visible, .form-range:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.btn-primary { border-color: var(--primary); background: var(--primary); color: var(--primary-foreground); }
.btn-primary:hover { background: color-mix(in srgb, var(--primary) 88%, var(--background)); }
.btn-ghost { border-color: transparent; background: transparent; }

.form-label { display: grid; gap: 5px; color: var(--foreground); font-weight: 400; }
.form-control, .form-select {
  appearance: none;
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--card);
  color: var(--foreground);
  padding: 6px 10px;
}
.form-select {
  padding-right: 30px;
  background-image: linear-gradient(45deg, transparent 50%, var(--muted-foreground) 50%), linear-gradient(135deg, var(--muted-foreground) 50%, transparent 50%);
  background-position: calc(100% - 15px) 14px, calc(100% - 10px) 14px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.form-range { appearance: none; width: 100%; height: 18px; margin: 0; background: transparent; }
.form-range::-webkit-slider-runnable-track { height: 3px; border-radius: 999px; background: var(--input); }
.form-range::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6.5px;
  border: 1px solid color-mix(in srgb, var(--foreground) 12%, transparent);
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 1px 3px rgb(0 0 0 / .18);
}
.form-check { display: inline-flex; align-items: center; gap: 7px; }
.form-check-input { width: 16px; height: 16px; accent-color: var(--accent); }
.form-check-label { color: var(--foreground); }
.form-control-color { width: 36px; min-height: 32px; padding: 3px; }
.form-switch .form-check-input {
  appearance: none;
  width: 32px;
  height: 18px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--input);
  transition: background-color 120ms ease;
}
.form-switch .form-check-input::before {
  content: "";
  display: block;
  width: 12px;
  height: 12px;
  margin: 2px;
  border-radius: 50%;
  background: var(--card);
  box-shadow: 0 1px 2px rgb(0 0 0 / .2);
  transition: transform 120ms ease;
}
.form-switch .form-check-input:checked { background: var(--accent); }
.form-switch .form-check-input:checked::before { transform: translateX(14px); }

.nav, .nav-pills { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.nav-justified { display: flex; width: 100%; }
.nav-justified .nav-link { flex: 1 1 0; }
.nav-link {
  appearance: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted-foreground);
  padding: 6px 9px;
}
.nav-link.active, .nav-link[aria-selected="true"] { background: var(--secondary); color: var(--foreground); }
.progress { height: 7px; overflow: hidden; border-radius: 999px; background: var(--muted); }
.progress-bar { height: 100%; border-radius: inherit; background: var(--accent); }

.table-responsive { width: 100%; overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }
.table th { color: var(--muted-foreground); font-size: 12px; font-weight: 500; }
.table-sm th, .table-sm td { padding: 5px 7px; }

.text-small { font-size: 12px; }
.text-muted { color: var(--muted-foreground); }
.text-destructive { color: var(--destructive); }
.text-warning { color: var(--viz-warning); }
.text-center { text-align: center; }
.text-end { text-align: end; }
.text-nowrap { white-space: nowrap; }
.tabular-nums { font-variant-numeric: tabular-nums; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

[data-tooltip] { position: relative; }
[data-tooltip] > .tooltip { display: none; }
[data-tooltip]:hover::after, [data-tooltip]:focus-visible::after {
  content: attr(data-tooltip);
  position: absolute;
  z-index: 20;
  left: 50%;
  bottom: calc(100% + 7px);
  transform: translateX(-50%);
  width: max-content;
  max-width: 220px;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--foreground);
  color: var(--background);
  font-size: 11px;
  line-height: 1.3;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;

// The bridge is installed before the fragment executes. Only the transferred
// MessagePort talks to the Mains parent; the sandboxed page never receives the
// preload API or direct filesystem access.
const VISUALIZATION_HOST_BRIDGE = String.raw`
(() => {
  "use strict";
  const MAX_STATE_BYTES = 16 * 1024;
  const stringify = JSON.stringify.bind(JSON);
  const NativeCustomEvent = window.CustomEvent;
  const NativeTextEncoder = window.TextEncoder;
  let hostPort = null;
  let widgetState = null;
  let theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

  function post(message) {
    try { hostPort?.postMessage(message); } catch { /* detached host */ }
  }

  function stateBytes(value) {
    const serialized = stringify(value);
    return new NativeTextEncoder().encode(serialized).byteLength;
  }

  function applyTheme(nextTheme) {
    theme = nextTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  }

  function emitGlobals() {
    window.dispatchEvent(new NativeCustomEvent("openai:set_globals", {
      detail: { globals: { theme, widgetState } }
    }));
  }

  const openai = {};
  Object.defineProperties(openai, {
    theme: { enumerable: true, get: () => theme },
    widgetState: { enumerable: true, get: () => widgetState },
    statePersistence: { enumerable: true, value: "local" },
    locale: { enumerable: true, value: navigator.language || "en" },
    setWidgetState: {
      enumerable: true,
      value: async (nextState) => {
        let size;
        try { size = stateBytes(nextState); } catch { throw new TypeError("Widget state must be JSON-serializable"); }
        if (size > MAX_STATE_BYTES) throw new RangeError("Widget state exceeds 16 KiB");
        widgetState = nextState;
        post({ type: "state", state: nextState });
        emitGlobals();
      }
    },
    openExternal: {
      enumerable: true,
      value: async (rawUrl) => {
        if (!navigator.userActivation?.isActive) throw new Error("A user gesture is required");
        const url = new URL(String(rawUrl));
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported URL");
        post({ type: "open-external", url: url.toString() });
      }
    },
    sendFollowUpMessage: {
      enumerable: true,
      value: async (request) => {
        if (!navigator.userActivation?.isActive) throw new Error("A user gesture is required");
        const prompt = typeof request?.prompt === "string" ? request.prompt.trim() : "";
        const title = typeof request?.title === "string" ? request.title.trim().slice(0, 250) : "";
        if (!prompt) throw new TypeError("A follow-up prompt is required");
        if (prompt.length > 20000) throw new RangeError("Follow-up prompt is too long");
        post({ type: "follow-up", prompt, ...(title ? { title } : {}) });
      }
    }
  });
  Object.defineProperty(window, "openai", { value: openai, configurable: false, writable: false });
  applyTheme(theme);

  let resizeFrame = 0;
  function reportHeight() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const body = document.body;
      const root = document.documentElement;
      const height = Math.ceil(Math.max(
        body?.scrollHeight || 0,
        root?.scrollHeight || 0,
        body?.getBoundingClientRect().height || 0
      ));
      if (height > 0) post({ type: "height", height });
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    if (event.data?.type !== "mains-visualization-init" || !event.ports?.[0]) return;
    if (hostPort) return;
    hostPort = event.ports[0];
    hostPort.onmessage = (hostEvent) => {
      const data = hostEvent.data;
      if (data?.type !== "host-update") return;
      if (data.theme) applyTheme(data.theme);
      if (Object.prototype.hasOwnProperty.call(data, "widgetState")) widgetState = data.widgetState;
      emitGlobals();
      reportHeight();
    };
    hostPort.start();
    applyTheme(event.data.theme);
    widgetState = event.data.widgetState ?? null;
    emitGlobals();
    reportHeight();
  });

  const observe = () => {
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(reportHeight);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    }
    reportHeight();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observe, { once: true });
  } else {
    observe();
  }
  window.addEventListener("load", reportHeight, { once: true });
})();
`;

export function isVisualizationFragment(fragment: string): boolean {
  return fragment.trim().length > 0 && !DOCUMENT_MARKUP.test(fragment);
}

export function renderVisualizationDocument(fragment: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${VISUALIZATION_BASE_CSS}</style>
  <script>${VISUALIZATION_HOST_BRIDGE}</script>
</head>
<body>
  <main id="mains-visualization-root">${fragment}</main>
  <script async src="https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js" onload="globalThis.lucide?.createIcons({ attrs: { width: 16, height: 16 } })"></script>
</body>
</html>`;
}

export async function serveLocalVisualization(
  requestUrl: URL,
): Promise<Response> {
  const verified = verifySignedPath(
    requestUrl.searchParams.get("path"),
    requestUrl.searchParams.get("exp"),
    requestUrl.searchParams.get("sig"),
  );
  if (!verified.ok) {
    return new Response(`Forbidden (${verified.reason})`, { status: 403 });
  }

  const resolved = path.resolve(verified.path);
  if (resolved.includes("\0")) return new Response("Invalid path", { status: 400 });
  if (path.extname(resolved).toLowerCase() !== ".html") {
    return new Response("Unsupported file type", { status: 400 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (stat.isSymbolicLink()) {
    return new Response("Symlinks not allowed", { status: 403 });
  }
  if (!stat.isFile()) return new Response("Not a file", { status: 404 });
  if (stat.size > MAX_VISUALIZATION_SIZE) {
    return new Response("Visualization too large", { status: 413 });
  }

  const fragment = fs.readFileSync(resolved, "utf8");
  if (!isVisualizationFragment(fragment)) {
    return new Response("Expected an HTML fragment", { status: 422 });
  }

  return new Response(renderVisualizationDocument(fragment), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": VISUALIZATION_CSP,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
    },
  });
}
