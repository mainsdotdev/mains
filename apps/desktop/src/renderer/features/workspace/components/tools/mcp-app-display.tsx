import {
  AppBridge,
  McpUiMessageRequestSchema,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiHostContext,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { useSuppressBrowserView } from "@/hooks/use-suppress-browser-view";
import { useCapabilities } from "@/lib/platform";
import { useDialogFocus } from "@/components/ui";
import { Maximize, Minimize } from "@/components/ui/icons";
import type { ServiceResponse } from "@mains/contracts/service-response";
import type { McpAppToolMetadata } from "@mains/contracts/mcp-apps";
import { mcpAppMessageOptions, mcpAppMessageText, type McpAppMessageOptions, type McpAppModelContextState } from "../../lib/mcp-app-context";
import { useMcpAppMessagePreview } from "../../hooks/use-mcp-app-message-preview";
import { McpAppMessageDialog } from "./mcp-app-message-dialog";
import { mcpAppToolName } from "../../lib/mcp-app-panel";

type McpAppDisplayMode = "inline" | "fullscreen";
type McpAppPresentation = McpAppDisplayMode | "collapsed";
const HOST_DISPLAY_MODES: McpAppDisplayMode[] = ["inline", "fullscreen"];
const INLINE_DISPLAY_MODES: McpAppDisplayMode[] = ["inline"];
// The base MCP Apps schema strips OpenAI routing metadata from message params.
const APP_MESSAGE_REQUEST = McpUiMessageRequestSchema.extend({
  params: McpUiMessageRequestSchema.shape.params.passthrough(),
});

class McpAppBridge extends AppBridge {
  setMessageHandler(handler: (content: unknown, meta?: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>) {
    this.replaceRequestHandler(APP_MESSAGE_REQUEST, async ({ params }, extra) => handler(params.content, params._meta, extra.signal));
  }
}

function supportedAppModes(value: unknown): McpAppDisplayMode[] | null {
  if (!Array.isArray(value)) return null;
  return HOST_DISPLAY_MODES.filter((mode) => value.includes(mode));
}

export type { McpAppToolMetadata } from "@mains/contracts/mcp-apps";

interface McpAppResourceMeta {
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  };
  permissions?: {
    camera?: Record<string, never>;
    microphone?: Record<string, never>;
    geolocation?: Record<string, never>;
    clipboardWrite?: Record<string, never>;
  };
  prefersBorder?: boolean;
  availableDisplayModes?: McpAppDisplayMode[];
}

interface LoadedMcpAppResource {
  url: string;
  mimeType: string;
  meta: McpAppResourceMeta;
}

interface McpAppDisplayProps {
  runId?: string;
  /** The source tool's thread remains the UI resource owner across new chats. */
  resourceRunId?: string;
  sessionId?: string;
  presentation?: "page";
  panelDisplayMode?: McpAppDisplayMode;
  onDisplayModeChange?: (mode: McpAppDisplayMode) => void;
  isActive?: boolean;
  registerBeforeSuspend?: (callback: () => Promise<void>) => () => void;
  /** Host compatibility failures that apps can handle through their own fallback. */
  unsupportedTools?: Readonly<Record<string, string>>;
  app: McpAppToolMetadata;
  input: Record<string, unknown> | null;
  output?: unknown;
  title: string;
  /** A page can submit its first message through the same composer as typed text. */
  onMessage?: (content: unknown, options?: McpAppMessageOptions) => Promise<void>;
  onModelContextChange?: (context: unknown) => Promise<McpAppModelContextState | null>;
  modelContext?: McpAppModelContextState | null;
}

interface CompatibilityMessage {
  type?: string;
  id?: number;
  method?: string;
  params?: unknown;
  height?: number;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return objectRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeToolResult(value: unknown): CallToolResult {
  const result = objectRecord(value) ?? {};
  return {
    content: Array.isArray(result.content)
      ? (result.content as CallToolResult["content"])
      : [],
    ...(result.structuredContent && typeof result.structuredContent === "object"
      ? { structuredContent: result.structuredContent as Record<string, unknown> }
      : {}),
    ...(typeof result.isError === "boolean" ? { isError: result.isError } : {}),
    ...(objectRecord(result._meta) ? { _meta: objectRecord(result._meta)! } : {}),
  };
}

function hostContext(
  isDark: boolean,
  displayMode: McpAppDisplayMode,
  isPage = false,
): McpUiHostContext {
  return {
    theme: isDark ? "dark" : "light",
    displayMode,
    availableDisplayModes: isPage ? ["fullscreen"] : HOST_DISPLAY_MODES,
    locale: navigator.language || "en",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: `Mains/${__APP_VERSION__}`,
    platform: "desktop",
    deviceCapabilities: {
      touch: navigator.maxTouchPoints > 0,
      hover: window.matchMedia("(hover: hover)").matches,
    },
    containerDimensions: displayMode === "fullscreen"
      ? { maxHeight: Math.max(120, window.innerHeight - 56), maxWidth: window.innerWidth }
      : { maxHeight: 1_200, maxWidth: 1_200 },
  };
}

function publishHostContext(
  bridge: AppBridge | null,
  state: { current: McpUiHostContext },
  changes: McpUiHostContext,
) {
  if (!bridge) return;
  // AppBridge replaces its cached context. Retain fields for a view's next handshake.
  state.current = { ...state.current, ...changes };
  bridge.setHostContext(state.current);
}

function externalHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function resultSignature(result: CallToolResult): string {
  try {
    return JSON.stringify(result);
  } catch {
    return String(Date.now());
  }
}

function compatibilityOutput(result: CallToolResult): unknown {
  return result.structuredContent ?? result.content;
}

export function McpAppDisplay({
  runId,
  resourceRunId: sourceRunId,
  sessionId,
  presentation: pagePresentation,
  panelDisplayMode,
  onDisplayModeChange,
  isActive = true,
  registerBeforeSuspend,
  unsupportedTools,
  app,
  input,
  output,
  title,
  onMessage,
  onModelContextChange,
  modelContext,
}: McpAppDisplayProps) {
  const isPage = pagePresentation === "page";
  const isPanel = panelDisplayMode !== undefined;
  const resourceOwner = sessionId ?? sourceRunId ?? runId;
  const resourceRunId = sessionId ? undefined : sourceRunId ?? runId;
  const resourceKey = `${resourceOwner}:${app.server}:${app.resourceUri}:${app.originCallId ?? ""}`;
  const messagePreview = useMcpAppMessagePreview(resourceKey);
  const { review: reviewMessage, cancel: cancelMessage } = messagePreview;
  const hasConversationHost = Boolean(onMessage);
  const hasContextHost = Boolean(onModelContextChange);
  const toolResult = useMemo(() => normalizeToolResult(output), [output]);
  const hasResult = output !== undefined && output !== null && output !== "";
  const isDark = useIsDarkMode();
  const { windowChrome } = useCapabilities();
  const { openUrl: openBrowserUrl } = useBrowserPanel();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const collapsedButtonRef = useRef<HTMLButtonElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const bridgeHostContextRef = useRef<McpUiHostContext>({});
  const initializedRef = useRef(false);
  // The window.openai shim can be ready without a standard MCP handshake.
  const compatibilityReadyRef = useRef(false);
  useEffect(() => registerBeforeSuspend?.(async () => {
    if (!initializedRef.current || !bridgeRef.current) return;
    try {
      await bridgeRef.current.teardownResource({}, { timeout: 1_500 });
    } catch {
      // Compatibility apps may not implement teardown. Their widget state is
      // already saved by setWidgetState; the conversation lives in the host.
    }
  }), [registerBeforeSuspend]);
  const latestContextRef = useRef<{ content?: unknown; structuredContent?: unknown } | null>(null);
  const conversationRef = useRef({ runId, onMessage, onModelContextChange, modelContext, unsupportedTools });
  const browserOpenRef = useRef(openBrowserUrl);
  const displayModeChangeRef = useRef(onDisplayModeChange);
  useLayoutEffect(() => {
    conversationRef.current = { runId, onMessage, onModelContextChange, modelContext, unsupportedTools };
    if (onModelContextChange) latestContextRef.current = modelContext ?? null;
    browserOpenRef.current = openBrowserUrl;
    displayModeChangeRef.current = onDisplayModeChange;
  }, [runId, onMessage, onModelContextChange, modelContext, unsupportedTools, openBrowserUrl, onDisplayModeChange]);
  useEffect(() => { if (!isActive) cancelMessage(); }, [isActive, cancelMessage]);
  const latestInputRef = useRef(input ?? {});
  const latestResultRef = useRef(toolResult);
  const hasResultRef = useRef(hasResult);
  const latestIsDarkRef = useRef(isDark);
  const lastSentResultRef = useRef<string | null>(null);
  const lastSentInputRef = useRef<string | null>(null);
  const lastCompatibilityResultRef = useRef<string | null>(null);
  const lastCompatibilityInputRef = useRef<string | null>(null);
  const [loadState, setLoadState] = useState<{
    key: string;
    resource?: LoadedMcpAppResource;
    error?: string;
  }>({ key: "" });
  const [height, setHeight] = useState(280);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [presentationOverride, setPresentationOverride] = useState<{
    key: string;
    mode: McpAppPresentation;
  } | null>(null);
  const [capabilityModes, setCapabilityModes] = useState<{
    key: string;
    modes: McpAppDisplayMode[];
  } | null>(null);
  const resource = loadState.key === resourceKey ? loadState.resource ?? null : null;
  const error = loadState.key === resourceKey ? loadState.error ?? null : null;
  const appDisplayModes = capabilityModes?.key === resourceKey
    ? capabilityModes.modes
    : resource?.meta.availableDisplayModes ?? (
      app.preferredModelDisplayMode === "fullscreen"
        ? HOST_DISPLAY_MODES
        : INLINE_DISPLAY_MODES
    );
  const initialDisplayMode = resource && appDisplayModes.includes("fullscreen") &&
    (app.preferredModelDisplayMode === "fullscreen" || !appDisplayModes.includes("inline"))
    ? "fullscreen"
    : "inline";
  const presentation = presentationOverride?.key === resourceKey
    ? presentationOverride.mode
    : initialDisplayMode;
  const isFullscreen = !isPage && presentation === "fullscreen";
  const isCollapsed = !isPage && presentation === "collapsed";
  const displayMode: McpAppDisplayMode = panelDisplayMode ?? (isPage || isFullscreen ? "fullscreen" : "inline");
  const displayModeRef = useRef(displayMode);
  const appDisplayModesRef = useRef(appDisplayModes);
  const hasDeclaredDisplayModesRef = useRef(false);
  const closeFullscreen = () => {
    setPresentationOverride({
      key: resourceKey,
      mode: appDisplayModes.includes("inline") ? "inline" : "collapsed",
    });
  };
  const handleDialogKeyDown = useDialogFocus({
    isOpen: isFullscreen && !!resource,
    dialogRef,
    onClose: closeFullscreen,
    initialFocusRef: closeButtonRef,
    returnFocusRef: expandButtonRef,
  });
  useSuppressBrowserView(isFullscreen && !!resource);
  const widgetStateKey = useMemo(
    () => `mcp-app-state:${resourceOwner}:${app.server}:${app.resourceUri}`,
    [resourceOwner, app.server, app.resourceUri],
  );

  useEffect(() => {
    if (!windowChrome) return;
    return window.api.app.onFullscreenChange(setIsNativeFullscreen);
  }, [windowChrome]);

  useEffect(() => {
    displayModeRef.current = displayMode;
    appDisplayModesRef.current = appDisplayModes;
    hasDeclaredDisplayModesRef.current = capabilityModes?.key === resourceKey ||
      resource?.meta.availableDisplayModes !== undefined;
  }, [displayMode, appDisplayModes, capabilityModes, resourceKey, resource]);

  useEffect(() => {
    latestInputRef.current = input ?? {};
    latestResultRef.current = toolResult;
    hasResultRef.current = hasResult;
  }, [input, toolResult, hasResult]);

  useEffect(() => {
    let cancelled = false;
    void window.api.mcpApps
      .readResource({
        runId: resourceRunId,
        sessionId,
        server: app.server,
        resourceUri: app.resourceUri,
        originCallId: app.originCallId,
        connectorId: app.connectorId,
        ...(app.linkId !== undefined ? { linkId: app.linkId } : {}),
      })
      .then((response: ServiceResponse<LoadedMcpAppResource>) => {
        if (cancelled) return;
        if (!response.success) throw new Error(response.error);
        setLoadState({ key: resourceKey, resource: response.data });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setLoadState({
            key: resourceKey,
            error: reason instanceof Error ? reason.message : String(reason),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resourceKey, resourceRunId, sessionId, app.server, app.resourceUri, app.originCallId, app.connectorId, app.linkId]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!resource || isCollapsed || !iframe) return;

    let disposed = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let frameReadyTimer: ReturnType<typeof setTimeout> | null = null;
    let connectionStarted = false;
    const frameReadyDeadline = Date.now() + 10_000;
    initializedRef.current = false;
    compatibilityReadyRef.current = false;
    if (!hasContextHost) latestContextRef.current = null;
    lastSentResultRef.current = null;
    lastSentInputRef.current = null;
    lastCompatibilityResultRef.current = null;
    lastCompatibilityInputRef.current = null;

    const callServerTool = async (
      tool: string,
      args?: Record<string, unknown>,
      meta?: Record<string, unknown>,
    ): Promise<CallToolResult> => {
      const unsupportedTools = conversationRef.current.unsupportedTools;
      const unsupported = unsupportedTools?.[tool] ?? unsupportedTools?.[tool.split(".").at(-1) ?? ""];
      if (unsupported) return { isError: true, content: [{ type: "text", text: unsupported }] };
      const response = (await window.api.mcpApps.callTool({
        runId: resourceRunId ?? conversationRef.current.runId,
        sessionId,
        server: app.server,
        tool: mcpAppToolName(app.server, app.tool, tool),
        arguments: args,
        meta,
      })) as ServiceResponse<unknown>;
      if (!response.success) throw new Error(response.error);
      return normalizeToolResult(response.data);
    };

    const sendMessage = async (content: unknown, meta?: unknown, signal?: AbortSignal) => {
      const options = mcpAppMessageOptions(meta);
      const text = mcpAppMessageText(content);
      if (!conversationRef.current.onMessage) {
        if (options.target === "new") throw new Error("Open the plugin page to start a new app conversation");
        if (!conversationRef.current.runId) throw new Error("Open this app in a conversation to send a message");
      }
      const approvedText = await reviewMessage(text, options.target === "new", signal);
      if (approvedText === null || disposed || signal?.aborted) return { isError: true };
      const approvedContent = [{ type: "text" as const, text: approvedText }];
      const { runId, onMessage } = conversationRef.current;
      if (onMessage) { await onMessage(approvedContent, options); return {}; }
      const response = (await window.api.mcpApps.sendMessage({
        runId,
        content: approvedContent,
        modelContext: latestContextRef.current ?? undefined,
      })) as ServiceResponse<unknown>;
      if (!response.success) throw new Error(response.error);
      return {};
    };

    const updateModelContext = async (context: unknown) => {
      const update = conversationRef.current.onModelContextChange;
      if (update) {
        const attached = await update(context);
        latestContextRef.current = attached;
        publishHostContext(bridgeRef.current, bridgeHostContextRef, { "openai/modelContext": attached });
        return { _meta: { "openai/modelContext": { updateId: attached?.updateId ?? crypto.randomUUID() } } };
      }
      latestContextRef.current = objectRecord(context);
      return {};
    };

    const openLink = async (rawUrl: unknown) => {
      const url = externalHttpUrl(rawUrl);
      if (!url) return { isError: true };
      if (isPage) await window.api.shell.openExternal(url);
      else await browserOpenRef.current(url);
      return {};
    };

    const initialHostContext: McpUiHostContext = {
      ...hostContext(latestIsDarkRef.current, displayModeRef.current, isPage && !isPanel),
      toolInfo: {
        id: app.originCallId ?? sessionId,
        tool: { name: app.tool, inputSchema: { type: "object" } },
      },
      ...(hasContextHost ? { "openai/modelContext": conversationRef.current.modelContext ?? null } : {}),
    };
    bridgeHostContextRef.current = initialHostContext;
    const bridge = new McpAppBridge(
      null,
      { name: "Mains", version: __APP_VERSION__ },
      {
        openLinks: {},
        serverTools: {},
        ...(hasConversationHost || resourceRunId ? { message: { text: {} } } : {}),
        updateModelContext: { text: {}, structuredContent: {},
          ...(hasContextHost ? { image: {}, resourceLink: {}, resource: {} } : {}) },
        ...((hasContextHost || hasConversationHost) ? { experimental: {
          ...(hasContextHost ? { "openai/modelContext": {} } : {}),
          ...(hasConversationHost ? { "openai/message": {} } : {}),
        } } : {}),
        sandbox: {
          csp: resource.meta.csp as McpUiResourceCsp | undefined,
          permissions: resource.meta.permissions as McpUiResourcePermissions | undefined,
        },
      },
      { hostContext: initialHostContext },
    );
    bridgeRef.current = bridge;

    bridge.oncalltool = ({ name, arguments: args, _meta }) =>
      callServerTool(
        name,
        args,
        objectRecord(_meta) ?? undefined,
      );
    bridge.onopenlink = ({ url }) => openLink(url);
    bridge.setMessageHandler(sendMessage);
    bridge.onupdatemodelcontext = updateModelContext;
    const requestDisplayMode = (requested: unknown): McpAppDisplayMode => {
      if (displayModeChangeRef.current && (requested === "inline" || requested === "fullscreen")) {
        displayModeRef.current = requested;
        displayModeChangeRef.current(requested);
        return requested;
      }
      if (isPage) return "fullscreen";
      if (
        (requested === "inline" || requested === "fullscreen") &&
        (appDisplayModesRef.current.includes(requested) ||
          (requested === "fullscreen" && !hasDeclaredDisplayModesRef.current))
      ) {
        if (!appDisplayModesRef.current.includes(requested)) {
          appDisplayModesRef.current = HOST_DISPLAY_MODES;
          setCapabilityModes({ key: resourceKey, modes: HOST_DISPLAY_MODES });
        }
        displayModeRef.current = requested;
        setPresentationOverride({ key: resourceKey, mode: requested });
      }
      return displayModeRef.current;
    };
    bridge.onrequestdisplaymode = async ({ mode }) => ({
      mode: requestDisplayMode(mode),
    });
    bridge.onsizechange = ({ height: nextHeight }) => {
      if (typeof nextHeight === "number" && Number.isFinite(nextHeight)) {
        setHeight(Math.min(1_200, Math.max(120, Math.ceil(nextHeight))));
      }
    };
    bridge.oninitialized = () => {
      initializedRef.current = true;
      const declaredModes = supportedAppModes(
        bridge.getAppCapabilities()?.availableDisplayModes,
      );
      if (declaredModes) {
        appDisplayModesRef.current = declaredModes;
        hasDeclaredDisplayModesRef.current = true;
        setCapabilityModes({ key: resourceKey, modes: declaredModes });
        if (declaredModes.length > 0 && !declaredModes.includes(displayModeRef.current)) {
          const fallback = declaredModes.includes("inline") ? "inline" : "fullscreen";
          displayModeRef.current = fallback;
          setPresentationOverride({ key: resourceKey, mode: fallback });
        }
      }
      publishHostContext(bridge, bridgeHostContextRef, hostContext(latestIsDarkRef.current, displayModeRef.current, isPage && !isPanel));
      if (hasContextHost) publishHostContext(bridge, bridgeHostContextRef, { "openai/modelContext": conversationRef.current.modelContext ?? null });
      lastSentInputRef.current = JSON.stringify(latestInputRef.current);
      void bridge.sendToolInput({ arguments: latestInputRef.current });
      if (hasResultRef.current) {
        const result = latestResultRef.current;
        lastSentResultRef.current = resultSignature(result);
        void bridge.sendToolResult(result);
      }
    };

    const postGlobals = () => {
      let widgetState: unknown = null;
      try {
        const stored = localStorage.getItem(widgetStateKey);
        widgetState = stored ? JSON.parse(stored) : null;
      } catch {
        // Storage is best-effort; a malformed old entry must not break the app.
      }
      iframe.contentWindow?.postMessage(
        {
          type: "mains:mcp-app-globals",
          globals: {
            toolInput: latestInputRef.current,
            toolOutput: compatibilityOutput(latestResultRef.current),
            toolResponseMetadata: latestResultRef.current._meta,
            widgetState,
            theme: latestIsDarkRef.current ? "dark" : "light",
            locale: navigator.language || "en",
            displayMode: displayModeRef.current,
          },
        },
        "*",
      );
      lastCompatibilityInputRef.current = JSON.stringify(latestInputRef.current);
      lastCompatibilityResultRef.current = hasResultRef.current ? resultSignature(latestResultRef.current) : null;
    };

    const respond = (id: number | undefined, result?: unknown, responseError?: unknown) => {
      if (id === undefined) return;
      iframe.contentWindow?.postMessage(
        {
          type: "mains:mcp-app-response",
          id,
          ...(responseError
            ? { error: responseError instanceof Error ? responseError.message : String(responseError) }
            : { result: result ?? {} }),
        },
        "*",
      );
    };

    const onCompatibilityMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const message = objectRecord(event.data) as CompatibilityMessage | null;
      if (!message) return;
      if (message.type === "mains:mcp-app-ready") {
        compatibilityReadyRef.current = true;
        postGlobals();
        return;
      }
      if (message.type === "mains:mcp-app-size") {
        const nextHeight = Number(message.height);
        if (Number.isFinite(nextHeight)) {
          setHeight(Math.min(1_200, Math.max(120, Math.ceil(nextHeight))));
        }
        return;
      }
      if (message.type !== "mains:mcp-app-request") return;

      const params = objectRecord(message.params) ?? {};
      let task: Promise<unknown>;
      switch (message.method) {
        case "tools/call":
          task = callServerTool(
            typeof params.name === "string" ? params.name : "",
            objectRecord(params.arguments) ?? {},
            objectRecord(params._meta) ?? undefined,
          );
          break;
        case "ui/open-link":
          task = openLink(params.url);
          break;
        case "ui/message":
          task = sendMessage(params.content, params._meta);
          break;
        case "ui/update-model-context":
          task = updateModelContext(params);
          break;
        case "ui/request-display-mode":
          task = Promise.resolve({ mode: requestDisplayMode(params.mode) });
          break;
        case "mains/set-widget-state":
          task = Promise.resolve().then(() => {
            try {
              localStorage.setItem(widgetStateKey, JSON.stringify(params.state ?? null));
            } catch {
              // Widget state persistence is optional.
            }
            return {};
          });
          break;
        default:
          task = Promise.reject(new Error(`Unsupported MCP App request: ${message.method}`));
      }
      void task.then(
        (result) => respond(message.id, result),
        (reason) => respond(message.id, undefined, reason),
      );
    };

    const connectFrame = () => {
      if (disposed || connectionStarted) return;
      if (frameReadyTimer) { clearTimeout(frameReadyTimer); frameReadyTimer = null; }
      const target = iframe.contentWindow;
      if (!target) {
        if (Date.now() >= frameReadyDeadline) {
          setLoadState({ key: resourceKey, error: "The app frame could not start. Reload the app to try again." });
          return;
        }
        frameReadyTimer = setTimeout(connectFrame, 50);
        return;
      }
      connectionStarted = true;
      const transport = new PostMessageTransport(target, target);
      void bridge.connect(transport).then(
        () => { if (!disposed) iframe.src = resource.url; },
        (reason: unknown) => {
          if (!disposed) setLoadState({ key: resourceKey,
            error: reason instanceof Error ? reason.message : String(reason) });
        },
      );
    };

    const onLoad = () => {
      connectFrame();
      // Ignore the placeholder document's load; only bootstrap the actual app.
      if (iframe.getAttribute("src") !== resource.url) return;
      postGlobals();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        if (disposed || initializedRef.current) return;
        const target = iframe.contentWindow;
        target?.postMessage(
          {
            jsonrpc: "2.0",
            method: "ui/notifications/tool-input",
            params: { arguments: latestInputRef.current },
          },
          "*",
        );
        if (hasResultRef.current) {
          target?.postMessage(
            {
              jsonrpc: "2.0",
              method: "ui/notifications/tool-result",
              params: latestResultRef.current,
            },
            "*",
          );
        }
      }, 750);
    };

    window.addEventListener("message", onCompatibilityMessage);
    iframe.addEventListener("load", onLoad);
    connectFrame();

    return () => {
      disposed = true;
      cancelMessage();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (frameReadyTimer) clearTimeout(frameReadyTimer);
      window.removeEventListener("message", onCompatibilityMessage);
      iframe.removeEventListener("load", onLoad);
      bridgeRef.current = null;
      initializedRef.current = false;
      compatibilityReadyRef.current = false;
      void bridge.close();
    };
  }, [
    resource,
    resourceKey,
    isCollapsed,
    resourceRunId,
    hasConversationHost,
    hasContextHost,
    sessionId,
    isPage,
    isPanel,
    app.server,
    app.tool,
    app.originCallId,
    widgetStateKey,
    reviewMessage,
    cancelMessage,
  ]);

  useEffect(() => {
    if (hasContextHost && initializedRef.current) {
      publishHostContext(bridgeRef.current, bridgeHostContextRef, { "openai/modelContext": modelContext ?? null });
    }
  }, [modelContext, hasContextHost]);

  useEffect(() => {
    const args = input ?? {};
    const signature = JSON.stringify(args);
    if (initializedRef.current && signature !== lastSentInputRef.current) {
      lastSentInputRef.current = signature;
      void bridgeRef.current?.sendToolInput({ arguments: args });
    }
    if (!compatibilityReadyRef.current || signature === lastCompatibilityInputRef.current) return;
    lastCompatibilityInputRef.current = signature;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "mains:mcp-app-globals", globals: { toolInput: args } },
      "*",
    );
  }, [input]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!hasResultRef.current) return;
    const result = latestResultRef.current;
    const signature = resultSignature(result);
    if (bridge && initializedRef.current && signature !== lastSentResultRef.current) {
      lastSentResultRef.current = signature;
      void bridge.sendToolResult(result);
    }
    if (!compatibilityReadyRef.current || signature === lastCompatibilityResultRef.current) return;
    lastCompatibilityResultRef.current = signature;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "mains:mcp-app-globals",
        globals: {
          toolOutput: compatibilityOutput(result),
          toolResponseMetadata: result._meta,
        },
      },
      "*",
    );
  }, [toolResult]);

  useEffect(() => {
    latestIsDarkRef.current = isDark;
    const updateHostContext = () => {
      if (initializedRef.current) {
        const rect = iframeRef.current?.getBoundingClientRect();
        publishHostContext(bridgeRef.current, bridgeHostContextRef, {
          ...hostContext(isDark, displayMode, isPage && !onDisplayModeChange),
          ...(rect && rect.width > 0 && rect.height > 0 ? { containerDimensions: { maxWidth: rect.width, maxHeight: rect.height } } : {}),
        });
      }
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "mains:mcp-app-globals",
          globals: {
            theme: isDark ? "dark" : "light",
            displayMode,
          },
        },
        "*",
      );
    };
    updateHostContext();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateHostContext);
    if (iframeRef.current) observer?.observe(iframeRef.current);
    window.addEventListener("resize", updateHostContext);
    return () => { observer?.disconnect(); window.removeEventListener("resize", updateHostContext); };
  }, [isDark, displayMode, isPage, onDisplayModeChange]);

  useEffect(() => {
    if (!isCollapsed) return;
    const frame = requestAnimationFrame(() => collapsedButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isCollapsed]);

  if (error) {
    return (
      <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
        Could not load MCP App: {error}
      </div>
    );
  }

  if (resource && (appDisplayModes.length === 0 || (isPage && !appDisplayModes.includes("fullscreen")))) {
    return (
      <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
        This app does not support a display mode available in Mains.
      </div>
    );
  }

  if (resource && isCollapsed) {
    return (
      <button
        ref={collapsedButtonRef}
        type="button"
        className="mt-2 flex w-full items-center justify-between rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5 text-left text-sm text-primary-800 hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-900 dark:text-primary-100 dark:hover:bg-primary-800"
        onClick={() => setPresentationOverride({ key: resourceKey, mode: "fullscreen" })}
      >
        <span className="truncate">{app.appName ?? title}</span>
        <span className="ml-3 inline-flex shrink-0 items-center gap-1.5 text-xs font-medium">
          <Maximize aria-hidden="true" className="size-3.5" />
          Open app
        </span>
      </button>
    );
  }

  const allow = buildAllowAttribute(
    resource?.meta.permissions as McpUiResourcePermissions | undefined,
  );

  return (
    <div
      ref={dialogRef}
      role={isFullscreen ? "dialog" : undefined}
      aria-modal={isFullscreen ? true : undefined}
      aria-label={isFullscreen ? `${app.appName ?? title} interactive app` : undefined}
      tabIndex={isFullscreen ? -1 : undefined}
      onKeyDown={isFullscreen ? handleDialogKeyDown : undefined}
      className={isPage
        ? "flex h-full min-h-0 flex-col overflow-hidden bg-primary dark:bg-primary-950"
        : isFullscreen
        ? "fixed inset-0 z-(--z-modal) flex min-h-0 flex-col bg-white shadow-2xl outline-none dark:bg-primary-950"
        : `mt-2 min-h-28 overflow-hidden bg-primary-50/50 dark:bg-primary/5 ${
          resource?.meta.prefersBorder === false ? "rounded-lg" : "rounded-xl"
        }`}
    >
      {!resource && (
        <div className="flex h-28 items-center justify-center gap-2 text-xs text-primary-500">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          Loading app…
        </div>
      )}
      {!isPage && resource && appDisplayModes.includes("fullscreen") && (
        <div className={`flex shrink-0 items-center justify-between border-b border-primary-200/70 dark:border-primary-800/70 ${
          isFullscreen
            ? `h-14 pr-5 ${windowChrome && !isNativeFullscreen ? "pl-24" : "pl-5"}`
            : "min-h-9 px-3"
        }`}>
          <span className={`min-w-0 truncate font-medium text-primary-800 dark:text-primary-100 ${
            isFullscreen ? "text-sm" : "text-xs"
          }`}>{app.appName ?? title}</span>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Return to chat"
            className={`${isFullscreen ? "inline-flex" : "hidden"} ml-3 shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:text-primary-300 dark:hover:bg-primary-800 dark:hover:text-white`}
            onClick={closeFullscreen}
          >
            <Minimize aria-hidden="true" className="size-4" />
            Back to chat
          </button>
          <button
            ref={expandButtonRef}
            type="button"
            aria-label={`Expand ${app.appName ?? title}`}
            className={`${isFullscreen ? "hidden" : "inline-flex"} ml-3 shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:text-primary-300 dark:hover:bg-primary-800 dark:hover:text-white`}
            onClick={() => setPresentationOverride({ key: resourceKey, mode: "fullscreen" })}
          >
            <Maximize aria-hidden="true" className="size-3.5" />
            Expand
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        // Start on an inert document; a made-up protocol URL creates a Chromium error frame.
        src="about:blank"
        title={`${title} interactive app`}
        className={resource
          ? `block w-full border-0 bg-transparent ${isPage || isFullscreen ? "min-h-0 flex-1" : ""}`
          : "hidden"}
        style={isPage || isFullscreen ? undefined : { height }}
        sandbox="allow-scripts allow-forms allow-same-origin"
        allow={allow || undefined}
        referrerPolicy="no-referrer"
      />
      {messagePreview.preview && <McpAppMessageDialog
        key={messagePreview.preview.id}
        appName={app.appName ?? title}
        preview={messagePreview.preview}
        onCancel={cancelMessage}
        onSend={messagePreview.confirm}
      />}
    </div>
  );
}
