import type { Space } from "./space";
import type { FloatingChatMode } from "./floating-chat";
import type { McpAppToolOpen } from "@mains/contracts/mcp-apps";

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
  mode: FloatingChatMode;
  draft: string;
  selectedModel: string;
  additionalDirectories?: string[];
  selectedCollectionId: string | null;
  /** Matches the parent renderer's theme without a second persistent writer. */
  dark: boolean;
  themeCss: string;
  rootStyle: string;
  contextItems: unknown[];
  uploadsVersion: number;
  uploads: BrowserChatUpload[];
  /** Mirrored display state; the parent alone owns queue execution and files. */
  runQueue?: unknown;
  draftRevision?: number;
}

export type BrowserChatAction =
  | { type: "queueReorder"; ownerKey: string; orderedIds: string[] }
  | { type: "queueSubmit"; ownerKey: string; draft: string; items: unknown[]; uploads: BrowserChatUpload[]; model?: string; additionalDirectories?: string[]; editingId?: string }
  | { type: "queueAction"; ownerKey: string; action: "steer" | "edit" | "remove" | "cancelEdit" | "resume" | "queueMode" | "steerMode" | "stop"; id?: string }
  | { type: "mode"; mode: FloatingChatMode }
  | { type: "pagePointerDown" }
  | { type: "composerHeight"; height: number }
  | { type: "draft"; ownerKey: string; draft: string }
  | { type: "model"; providerId: string; model: string }
  | { type: "directories"; ownerKey: string; directories: string[] }
  | { type: "selectRun"; ownerKey: string; runId: string }
  | { type: "openMcpApp"; ownerKey: string; result: McpAppToolOpen; automatic: boolean }
  | { type: "providerChanged"; providerId: string }
  | { type: "uploads"; ownerKey: string; uploads: BrowserChatUpload[] }
  | { type: "contextItems"; ownerKey: string; items: unknown[] };
