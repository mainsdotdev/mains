export interface McpAppResourceCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export interface McpAppResourcePermissions {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
}

export interface McpAppResourceMeta {
  csp?: McpAppResourceCsp;
  permissions?: McpAppResourcePermissions;
  domain?: string;
  prefersBorder?: boolean;
}

const WEB_ORIGIN = /^(https?):\/\/(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?\/?$/i;
const CONNECT_ORIGIN = /^(https?|wss?):\/\/(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?\/?$/i;

function declaredOrigins(
  values: unknown,
  kind: "web" | "connect",
): string[] {
  if (!Array.isArray(values)) return [];
  const pattern = kind === "connect" ? CONNECT_ORIGIN : WEB_ORIGIN;
  return [...new Set(values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const candidate = value.trim();
    if (!pattern.test(candidate)) return [];
    return [candidate.replace(/\/$/, "")];
  }))];
}

function sourceList(values: string[]): string {
  return values.length > 0 ? values.join(" ") : "'none'";
}

/** Return the exact origin allowlists Mains will apply to the iframe. */
export function sanitizeMcpAppResourceCsp(
  csp: McpAppResourceCsp | null | undefined,
): McpAppResourceCsp | undefined {
  const connectDomains = declaredOrigins(csp?.connectDomains, "connect");
  const resourceDomains = declaredOrigins(csp?.resourceDomains, "web");
  const frameDomains = declaredOrigins(csp?.frameDomains, "web");
  const baseUriDomains = declaredOrigins(csp?.baseUriDomains, "web");
  if (
    connectDomains.length === 0 &&
    resourceDomains.length === 0 &&
    frameDomains.length === 0 &&
    baseUriDomains.length === 0
  ) {
    return undefined;
  }
  return {
    ...(connectDomains.length > 0 ? { connectDomains } : {}),
    ...(resourceDomains.length > 0 ? { resourceDomains } : {}),
    ...(frameDomains.length > 0 ? { frameDomains } : {}),
    ...(baseUriDomains.length > 0 ? { baseUriDomains } : {}),
  };
}

/** Build the iframe policy from the allowlists declared by the MCP resource. */
export function buildMcpAppContentSecurityPolicy(
  csp: McpAppResourceCsp | null | undefined,
): string {
  const safe = sanitizeMcpAppResourceCsp(csp);
  const connect = safe?.connectDomains ?? [];
  const resources = safe?.resourceDomains ?? [];
  const frames = safe?.frameDomains ?? [];
  const bases = safe?.baseUriDomains ?? [];
  const resourceSources = resources.join(" ");

  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:${resourceSources ? ` ${resourceSources}` : ""}`,
    `style-src 'unsafe-inline'${resourceSources ? ` ${resourceSources}` : ""}`,
    `img-src data: blob:${resourceSources ? ` ${resourceSources}` : ""}`,
    `font-src data:${resourceSources ? ` ${resourceSources}` : ""}`,
    `media-src data: blob:${resourceSources ? ` ${resourceSources}` : ""}`,
    `connect-src ${sourceList(connect)}`,
    `frame-src ${sourceList(frames)}`,
    `base-uri ${bases.length > 0 ? bases.join(" ") : "'self'"}`,
    `worker-src blob:${resourceSources ? ` ${resourceSources}` : ""}`,
    "object-src 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function buildMcpAppPermissionsPolicy(
  permissions: McpAppResourcePermissions | null | undefined,
): string {
  const enabled = (value: unknown) => value && typeof value === "object";
  return [
    `camera=${enabled(permissions?.camera) ? "*" : "()"}`,
    `microphone=${enabled(permissions?.microphone) ? "*" : "()"}`,
    `geolocation=${enabled(permissions?.geolocation) ? "*" : "()"}`,
    `clipboard-write=${enabled(permissions?.clipboardWrite) ? "*" : "()"}`,
    "payment=()",
    "usb=()",
    "serial=()",
  ].join(", ");
}

// ChatGPT compatibility surface. It lives inside the sandbox and communicates
// only through narrowly-scoped messages that the parent validates by source.
const MCP_APP_COMPATIBILITY_BRIDGE = String.raw`
(() => {
  "use strict";
  const pending = new Map();
  let nextId = 1;
  let toolInput;
  let toolOutput;
  let toolResponseMetadata;
  let widgetState = null;
  let theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  let locale = navigator.language || "en";
  let displayMode = "inline";

  function send(method, params, wantsResponse = true) {
    const id = nextId++;
    parent.postMessage({ type: "mains:mcp-app-request", id, method, params }, "*");
    if (!wantsResponse) return Promise.resolve({});
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  function externalWebUrl(value) {
    try {
      const url = new URL(String(value), document.baseURI);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  // External links cannot create a popup inside this sandbox. Route ordinary
  // target-blank anchors through the same host capability as ui/open-link.
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
    if (!anchor || anchor.target.toLowerCase() !== "_blank") return;
    const url = externalWebUrl(anchor.href);
    if (!url) return;
    event.preventDefault();
    void send("ui/open-link", { url }).catch(() => undefined);
  });

  function emitGlobals(changed) {
    window.dispatchEvent(new CustomEvent("openai:set_globals", {
      detail: { globals: changed }
    }));
  }

  function applyGlobals(globals) {
    const changed = {};
    if (Object.prototype.hasOwnProperty.call(globals, "toolInput")) changed.toolInput = toolInput = globals.toolInput;
    if (Object.prototype.hasOwnProperty.call(globals, "toolOutput")) changed.toolOutput = toolOutput = globals.toolOutput;
    if (Object.prototype.hasOwnProperty.call(globals, "toolResponseMetadata")) changed.toolResponseMetadata = toolResponseMetadata = globals.toolResponseMetadata;
    if (Object.prototype.hasOwnProperty.call(globals, "widgetState")) changed.widgetState = widgetState = globals.widgetState;
    if (globals.theme === "light" || globals.theme === "dark") changed.theme = theme = globals.theme;
    if (typeof globals.locale === "string") changed.locale = locale = globals.locale;
    if (typeof globals.displayMode === "string") changed.displayMode = displayMode = globals.displayMode;
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = locale;
    document.documentElement.style.colorScheme = theme;
    emitGlobals(changed);
  }

  const openai = {};
  Object.defineProperties(openai, {
    toolInput: { enumerable: true, get: () => toolInput },
    toolOutput: { enumerable: true, get: () => toolOutput },
    toolResponseMetadata: { enumerable: true, get: () => toolResponseMetadata },
    widgetState: { enumerable: true, get: () => widgetState },
    theme: { enumerable: true, get: () => theme },
    locale: { enumerable: true, get: () => locale },
    displayMode: { enumerable: true, get: () => displayMode },
    statePersistence: { enumerable: true, value: "local" },
    callTool: {
      enumerable: true,
      value: (nameOrRequest, args) => {
        const request = typeof nameOrRequest === "string"
          ? { name: nameOrRequest, arguments: args ?? {} }
          : nameOrRequest;
        return send("tools/call", request);
      }
    },
    openExternal: {
      enumerable: true,
      value: (value) => send("ui/open-link", {
        url: String(value?.href ?? value?.url ?? value)
      })
    },
    sendFollowUpMessage: {
      enumerable: true,
      value: (request) => send("ui/message", {
        role: "user",
        content: [{ type: "text", text: String(request?.prompt ?? request ?? "") }]
      })
    },
    requestDisplayMode: {
      enumerable: true,
      value: (request) => send("ui/request-display-mode", request ?? {})
    },
    setWidgetState: {
      enumerable: true,
      value: (state) => {
        widgetState = state;
        emitGlobals({ widgetState: state });
        return send("mains/set-widget-state", { state }, false);
      }
    }
  });

  if (!window.openai) {
    Object.defineProperty(window, "openai", {
      value: openai,
      configurable: false,
      writable: false
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || typeof event.data !== "object") return;
    const message = event.data;
    if (message.type === "mains:mcp-app-globals") {
      applyGlobals(message.globals ?? {});
      return;
    }
    if (message.type !== "mains:mcp-app-response" || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(String(message.error)));
    else request.resolve(message.result);
  });

  let resizeFrame = 0;
  function reportSize() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const root = document.documentElement;
      const body = document.body;
      const height = Math.ceil(Math.max(
        root?.scrollHeight || 0,
        body?.scrollHeight || 0,
        root?.getBoundingClientRect().height || 0,
        body?.getBoundingClientRect().height || 0
      ));
      parent.postMessage({
        type: "mains:mcp-app-size",
        width: Math.ceil(root?.scrollWidth || 0),
        height
      }, "*");
    });
  }
  const observe = () => {
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(reportSize);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    }
    reportSize();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe, { once: true });
  else observe();
  window.addEventListener("load", reportSize, { once: true });
  parent.postMessage({ type: "mains:mcp-app-ready" }, "*");
})();
`;

const DOCUMENT_MARKUP = /<!doctype\b|<\s*\/?\s*(?:html|head|body)\b/i;

/** Inject the compatibility bridge before any app script executes. */
export function renderMcpAppDocument(html: string): string {
  const bridge = `<script data-mains-mcp-app-bridge>${MCP_APP_COMPATIBILITY_BRIDGE}</script>`;
  if (!DOCUMENT_MARKUP.test(html)) {
    return `<!doctype html><html><head><meta charset="utf-8">${bridge}</head><body>${html}</body></html>`;
  }
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${bridge}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${bridge}</head>`);
  }
  const doctype = html.match(/<!doctype\b[^>]*>/i)?.[0] ?? "<!doctype html>";
  const content = html.replace(/<!doctype\b[^>]*>/i, "");
  if (/<body(?:\s[^>]*)?>/i.test(content)) {
    return `${doctype}<html><head><meta charset="utf-8">${bridge}</head>${content}</html>`;
  }
  return `${doctype}<html><head><meta charset="utf-8">${bridge}</head><body>${content}</body></html>`;
}
