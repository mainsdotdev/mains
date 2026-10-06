import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "path";
import { CHANNELS } from "@mains/contracts/channels";
import { ok, fail } from "@mains/contracts/service-response";
import type {
  BrowserChatAction,
  BrowserChatContext,
  BrowserChatWindowState,
} from "../../../shared/browser-chat-window";
import { getMainWindow } from "../../windows/mainWindow";
import { isModeId } from "@mains/contracts/modes";
import { conversationSettingsFrom } from "@mains/contracts/run-settings";

function finiteRect(value: unknown): value is BrowserChatWindowState["bounds"] {
  if (!value || typeof value !== "object") return false;
  const rect = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every(
    (key) => typeof rect[key] === "number" && Number.isFinite(rect[key]),
  ) && (rect.width as number) > 0 && (rect.height as number) > 0;
}

function validWindowState(value: unknown): value is BrowserChatWindowState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.visible === "boolean" && finiteRect(state.bounds) && finiteRect(state.card);
}

function validContext(value: unknown): value is BrowserChatContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  const space = context.activeSpace as Record<string, unknown> | null;
  return (
    ["route", "activeTab", "providerId", "ownerKey", "draft", "selectedModel", "themeCss", "rootStyle"].every(
      (key) => typeof context[key] === "string",
    ) &&
    Array.isArray(context.contextItems) &&
    Array.isArray(context.uploads) &&
    typeof context.uploadsVersion === "number" && Number.isFinite(context.uploadsVersion) &&
    (context.mode === "details" || context.mode === "input" || context.mode === "icon") &&
    (context.selectedCollectionId === null || typeof context.selectedCollectionId === "string") &&
    !!space && typeof space === "object" &&
    typeof space.id === "string" && space.id.length > 0 &&
    space.providerId === context.providerId &&
    isModeId(space.mode) &&
    typeof context.dark === "boolean"
  );
}

function validAction(value: unknown): value is BrowserChatAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  const validSource = action.source === undefined || action.source === "user" || action.source === "automatic";
  switch (action.type) {
    case "queueReorder": return typeof action.ownerKey === "string" && Array.isArray(action.orderedIds) &&
      action.orderedIds.every((id) => typeof id === "string" && id.length > 0) && new Set(action.orderedIds).size === action.orderedIds.length;
    case "queueSubmit": return typeof action.ownerKey === "string" && typeof action.draft === "string" &&
      Array.isArray(action.items) && Array.isArray(action.uploads) &&
      (action.model === undefined || typeof action.model === "string") &&
      (action.editingId === undefined || typeof action.editingId === "string") &&
      (action.additionalDirectories === undefined || Array.isArray(action.additionalDirectories) && action.additionalDirectories.every((dir) => typeof dir === "string"));
    case "queueAction": return typeof action.ownerKey === "string" &&
      ["steer", "edit", "remove", "cancelEdit", "resume", "queueMode", "steerMode", "stop"].includes(String(action.action)) &&
      (action.id === undefined || typeof action.id === "string");
    case "mode": return action.mode === "details" || action.mode === "input" || action.mode === "icon";
    case "pagePointerDown": return true;
    case "composerHeight": return typeof action.height === "number" && Number.isFinite(action.height) && action.height >= 48 && action.height <= 1024;
    case "draft": return typeof action.ownerKey === "string" && typeof action.draft === "string";
    case "model": return typeof action.providerId === "string" && typeof action.model === "string" && validSource;
    case "conversationSettings": return typeof action.ownerKey === "string" && validSource &&
      conversationSettingsFrom({ conversationSettings: action.settings }) !== null;
    case "directories": return typeof action.ownerKey === "string" && Array.isArray(action.directories) && action.directories.every((dir) => typeof dir === "string");
    case "selectRun": return typeof action.ownerKey === "string" && typeof action.runId === "string" && action.runId.length > 0;
    case "openMcpApp": {
      const result = action.result as Record<string, unknown> | null;
      const app = result?.app as Record<string, unknown> | null;
      return typeof action.ownerKey === "string" && typeof action.automatic === "boolean" &&
        !!result && typeof result === "object" && !Array.isArray(result) &&
        typeof result.runId === "string" && result.runId.length > 0 && typeof result.title === "string" &&
        !!app && typeof app === "object" && !Array.isArray(app) &&
        ["server", "tool", "resourceUri"].every((key) => typeof app[key] === "string" && (app[key] as string).length > 0) &&
        (app.resourceUri as string).startsWith("ui://") &&
        ["originCallId", "connectorId", "appName", "actionName"].every((key) => app[key] === undefined || typeof app[key] === "string") &&
        (app.linkId === undefined || app.linkId === null || typeof app.linkId === "string") &&
        (app.preferredModelDisplayMode === undefined || app.preferredModelDisplayMode === "inline" || app.preferredModelDisplayMode === "fullscreen") &&
        (result.input == null || typeof result.input === "object" && !Array.isArray(result.input)) &&
        result.output != null;
    }
    case "providerChanged": return typeof action.providerId === "string" && action.providerId.length > 0;
    case "uploads": return typeof action.ownerKey === "string" && Array.isArray(action.uploads);
    case "contextItems": return typeof action.ownerKey === "string" && Array.isArray(action.items);
    default: return false;
  }
}

/** Native child window whose transparent area passes pointer input to the live browser. */
export const browserChatWindow = {
  window: null as BrowserWindow | null,
  state: null as BrowserChatWindowState | null,
  context: null as BrowserChatContext | null,
  interactive: false,
  portalInteractive: false,
  /** A full-window modal must receive clicks beyond the compact chat card. */
  overlayInteractive: false,
  pointerOutsideSince: null as number | null,
  parentListeners: null as (() => void) | null,
  pointerTimer: null as ReturnType<typeof setInterval> | null,

  _parent(): BrowserWindow | null {
    const parent = getMainWindow();
    return parent && !parent.isDestroyed() ? parent : null;
  },

  _position() {
    const parent = this._parent();
    const child = this.window;
    const state = this.state;
    if (!parent || !child || child.isDestroyed() || !state) return;
    const content = parent.getContentBounds();
    const { bounds } = state;
    const next = {
      x: Math.round(content.x + bounds.x),
      y: Math.round(content.y + bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
    const current = child.getBounds();
    if (current.x === next.x && current.y === next.y &&
        current.width === next.width && current.height === next.height) return;
    child.setBounds(next);
  },

  _syncVisibility() {
    const parent = this._parent();
    const child = this.window;
    if (!parent || !child || child.isDestroyed()) return;
    if (this.state?.visible && parent.isVisible() && !parent.isMinimized()) {
      this._position();
      if (!child.isVisible()) child.showInactive();
      this._startPointerTracking();
      this._syncInitialHitTest();
    } else if (child.isVisible()) {
      child.hide();
      this._stopPointerTracking();
    } else {
      this._stopPointerTracking();
    }
  },

  _pointerInCard() {
    const state = this.state;
    const parent = this._parent();
    if (!state || !parent) return false;
    const pointer = screen.getCursorScreenPoint();
    const content = parent.getContentBounds();
    const { card } = state;
    return pointer.x >= content.x + card.x && pointer.x < content.x + card.x + card.width &&
      pointer.y >= content.y + card.y && pointer.y < content.y + card.y + card.height;
  },

  _syncInitialHitTest() {
    if (!this.window || !this.state || !this._parent()) return;
    this.setInteractive(this.overlayInteractive || this._pointerInCard());
  },

  _startPointerTracking() {
    if (this.pointerTimer) return;
    // Electron's forwarded mousemove is not guaranteed to wake an ignored
    // child window. Poll while visible so the card becomes clickable on entry
    // and the browser gets input back on exit. Give portaled menus one frame to
    // report their own hit test before allowing the pointer through.
    this.pointerTimer = setInterval(() => {
      if (this.overlayInteractive) {
        this.pointerOutsideSince = null;
        if (!this.interactive) this.setInteractive(true);
        return;
      }
      if (this._pointerInCard()) {
        this.portalInteractive = false;
        this.pointerOutsideSince = null;
        if (!this.interactive) this.setInteractive(true);
        return;
      }
      if (!this.interactive || this.portalInteractive) {
        this.pointerOutsideSince = null;
        return;
      }
      if (this.pointerOutsideSince === null) {
        this.pointerOutsideSince = Date.now();
      } else if (Date.now() - this.pointerOutsideSince >= 48) {
        this.setInteractive(false);
      }
    }, 32);
  },

  _stopPointerTracking() {
    if (!this.pointerTimer) return;
    clearInterval(this.pointerTimer);
    this.pointerTimer = null;
    this.pointerOutsideSince = null;
  },

  _ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const parent = this._parent();
    if (!parent) throw new Error("No main window for browser chat");

    const child = new BrowserWindow({
      parent,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      acceptFirstMouse: true,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        devTools: !app.isPackaged,
        backgroundThrottling: false,
      },
    });
    this.window = child;
    this.interactive = false;
    this.portalInteractive = false;
    this.overlayInteractive = false;
    this.pointerOutsideSince = null;
    child.setIgnoreMouseEvents(true, { forward: true });
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    child.webContents.on("will-navigate", (event) => event.preventDefault());
    child.webContents.on("did-finish-load", () => {
      if (this.context) child.webContents.send(CHANNELS.browser.chatContext, this.context);
    });
    child.on("closed", () => {
      if (this.window === child) {
        this.window = null;
        this.interactive = false;
        this.portalInteractive = false;
        this.overlayInteractive = false;
      }
      this._stopPointerTracking();
      this.parentListeners?.();
      this.parentListeners = null;
    });

    const reposition = () => this._position();
    const visibility = () => this._syncVisibility();
    parent.on("move", reposition);
    parent.on("resize", reposition);
    parent.on("enter-full-screen", visibility);
    parent.on("leave-full-screen", visibility);
    parent.on("show", visibility);
    parent.on("hide", visibility);
    parent.on("minimize", visibility);
    parent.on("restore", visibility);
    this.parentListeners = () => {
      parent.off("move", reposition);
      parent.off("resize", reposition);
      parent.off("enter-full-screen", visibility);
      parent.off("leave-full-screen", visibility);
      parent.off("show", visibility);
      parent.off("hide", visibility);
      parent.off("minimize", visibility);
      parent.off("restore", visibility);
    };

    const devServerUrl = process.env.VITE_DEV_SERVER_URL ||
      process.env.RENDERER_VITE_DEV_SERVER_URL || "http://localhost:5173";
    if (!app.isPackaged) {
      void child.loadURL(`${devServerUrl}?browserChatOverlay=1`);
    } else {
      void child.loadFile(path.join(__dirname, "../renderer/index.html"), {
        query: { browserChatOverlay: "1" },
      });
    }
    return child;
  },

  update(state: BrowserChatWindowState) {
    this.state = state;
    if (!state.visible && !this.window) return;
    this._ensure();
    this._syncVisibility();
  },

  publish(context: BrowserChatContext) {
    this.context = context;
    const child = this.window;
    if (child && !child.isDestroyed() && !child.webContents.isLoading()) {
      child.webContents.send(CHANNELS.browser.chatContext, context);
    }
  },

  setInteractive(interactive: boolean) {
    const child = this.window;
    if (!child || child.isDestroyed()) return;
    if (this.overlayInteractive && !interactive) return;
    this.portalInteractive = interactive && !this.overlayInteractive && !this._pointerInCard();
    this.pointerOutsideSince = null;
    if (this.interactive === interactive) return;
    // Native geometry is authoritative for the card itself. A delayed DOM
    // mousemove can otherwise turn pass-through back on directly over chat.
    if (!interactive && this.state?.visible && this._pointerInCard()) return;
    this.interactive = interactive;
    child.setIgnoreMouseEvents(!interactive, { forward: !interactive });
  },

  setOverlayInteractive(interactive: boolean) {
    this.overlayInteractive = interactive;
    if (interactive) {
      this.setInteractive(true);
    } else {
      this.portalInteractive = false;
      this._syncInitialHitTest();
    }
  },

  postAction(action: BrowserChatAction) {
    const parent = this._parent();
    if (parent) parent.webContents.send(CHANNELS.browser.chatAction, action);
  },

  destroy() {
    this.state = null;
    this.context = null;
    this.parentListeners?.();
    this.parentListeners = null;
    this._stopPointerTracking();
    const child = this.window;
    this.window = null;
    this.interactive = false;
    this.portalInteractive = false;
    this.overlayInteractive = false;
    if (child && !child.isDestroyed()) child.destroy();
  },
};

export function registerBrowserChatWindowIpc() {
  ipcMain.handle(CHANNELS.browser.chatUpdateWindow, (event, state: unknown) => {
    if (event.sender !== getMainWindow()?.webContents || !validWindowState(state)) return fail("Invalid browser chat window state");
    browserChatWindow.update(state);
    return ok(null);
  });
  ipcMain.handle(CHANNELS.browser.chatPublishContext, (event, context: unknown) => {
    if (event.sender !== getMainWindow()?.webContents || !validContext(context)) return fail("Invalid browser chat context");
    browserChatWindow.publish(context);
    return ok(null);
  });
  ipcMain.handle(CHANNELS.browser.chatGetContext, (event) => {
    if (event.sender !== browserChatWindow.window?.webContents) return fail("Browser chat unavailable");
    return ok(browserChatWindow.context);
  });
  ipcMain.handle(CHANNELS.browser.chatPostAction, (event, action: unknown) => {
    if (event.sender !== browserChatWindow.window?.webContents || !validAction(action)) return fail("Invalid browser chat action");
    browserChatWindow.postAction(action);
    return ok(null);
  });
  ipcMain.handle(CHANNELS.browser.chatSetInteractive, (event, interactive: unknown) => {
    if (event.sender !== browserChatWindow.window?.webContents || typeof interactive !== "boolean") return fail("Invalid browser chat pointer state");
    browserChatWindow.setInteractive(interactive);
    return ok(null);
  });
  ipcMain.handle(CHANNELS.browser.chatSetOverlayInteractive, (event, interactive: unknown) => {
    if (event.sender !== browserChatWindow.window?.webContents || typeof interactive !== "boolean") return fail("Invalid browser chat overlay state");
    browserChatWindow.setOverlayInteractive(interactive);
    return ok(null);
  });
}

export function unregisterBrowserChatWindowIpc() {
  browserChatWindow.destroy();
  ipcMain.removeHandler(CHANNELS.browser.chatUpdateWindow);
  ipcMain.removeHandler(CHANNELS.browser.chatPublishContext);
  ipcMain.removeHandler(CHANNELS.browser.chatGetContext);
  ipcMain.removeHandler(CHANNELS.browser.chatPostAction);
  ipcMain.removeHandler(CHANNELS.browser.chatSetInteractive);
  ipcMain.removeHandler(CHANNELS.browser.chatSetOverlayInteractive);
}
