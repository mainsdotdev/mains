import type { Space } from "./space";

export type BrowserChatMode = "details" | "input" | "icon";

export interface BrowserChatUpload {
  name: string;
  type: string;
  data: string;
  mimeType: string;
}

export interface BrowserChatWindowState {
  visible: boolean;
  /** Stable native overlay bounds in main-renderer CSS pixels. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Chat surface in main-renderer coordinates, for initial mouse hit testing. */
  card: { x: number; y: number; width: number; height: number };
}

export interface BrowserChatContext {
  route: string;
  activeTab: string;
  /** Authoritative Space from the main renderer; the child has a separate query cache. */
  activeSpace: Space;
  providerId: string;
  ownerKey: string;
  mode: BrowserChatMode;
  draft: string;
  selectedModel: string;
  selectedCollectionId: string | null;
  /** Matches the parent renderer's theme without a second persistent writer. */
  dark: boolean;
  themeCss: string;
  rootStyle: string;
  contextItems: unknown[];
  uploadsVersion: number;
  uploads: BrowserChatUpload[];
}

export type BrowserChatAction =
  | { type: "mode"; mode: BrowserChatMode }
  | { type: "pagePointerDown" }
  | { type: "composerHeight"; height: number }
  | { type: "draft"; ownerKey: string; draft: string }
  | { type: "model"; providerId: string; model: string }
  | { type: "selectRun"; ownerKey: string; runId: string }
  | { type: "providerChanged"; providerId: string }
  | { type: "uploads"; ownerKey: string; uploads: BrowserChatUpload[] }
  | { type: "contextItems"; ownerKey: string; items: unknown[] };
