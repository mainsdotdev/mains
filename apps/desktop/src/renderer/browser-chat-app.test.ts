// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserChatContext } from "../shared/browser-chat-window";
import type { Space } from "../shared/space";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useMcpAppToolOpener } from "@/hooks/use-mcp-app-tool-opener";
import type { McpAppToolOpen } from "@mains/contracts/mcp-apps";

const appResult: McpAppToolOpen = { runId: "run-1", title: "MagicPath", input: {}, output: { content: [] },
  app: { server: "codex_apps", tool: "magicpath.open", resourceUri: "ui://magicpath", originCallId: "call-1" } };

const harness = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("@/lib/redux", () => ({ persistor: { pause: vi.fn() } }));
vi.mock("@/lib/redux/hooks", () => ({ useAppDispatch: () => harness.dispatch }));
vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: { activeSpaceId: "space-claude" }, isLoading: false }),
  useGetSpacesQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/providers/redux-provider", () => ({
  ReduxProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({
  KeyboardShortcutsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/ui", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
  Toaster: () => null,
}));
vi.mock("@/lib/provider-variants", () => ({
  getProviderVariantById: (id: string) => ({ variant: id === "codex" ? "codex" : "claude" }),
}));
vi.mock("@/features/workspace/components/workspace-provider-page", () => ({
  WorkspaceProviderPage: () => {
    const { activeSpaceId, activeSpace } = useActiveSpace();
    const openTool = useMcpAppToolOpener();
    return createElement("div", null,
      createElement("output", { "data-testid": "child-space" }, `${activeSpaceId}:${activeSpace?.providerId}`),
      createElement("button", { onClick: () => openTool?.(appResult) }, "Open app"),
      createElement("button", { onClick: () => openTool?.(appResult, true) }, "New app result"));
  },
}));

import BrowserChatApp from "./browser-chat-app";

function space(id: string, providerId: Space["providerId"]): Space {
  return {
    id,
    providerId,
    accountId: "default",
    name: id,
    slug: id,
    description: null,
    systemPrompt: null,
    model: null,
    icon: null,
    themeConfig: null,
    mode: "developer",
    sortOrder: 0,
    isArchived: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function context(activeSpace: Space): BrowserChatContext {
  return {
    route: "/code",
    activeTab: "new-run",
    activeSpace,
    providerId: activeSpace.providerId,
    ownerKey: "draft",
    mode: "input",
    draft: "",
    selectedModel: "",
    selectedCollectionId: null,
    dark: false,
    themeCss: "",
    rootStyle: "",
    contextItems: [],
    uploadsVersion: 0,
    uploads: [],
  };
}

describe("browser chat Space sync", () => {
  it("routes both transcript clicks and newly completed apps to the main renderer", () => {
    let onContext: ((next: BrowserChatContext) => void) | undefined;
    const postAction = vi.fn();
    vi.stubGlobal("api", { browserChat: {
      onContext: (callback: typeof onContext) => { onContext = callback; return vi.fn(); },
      getContext: async () => ({ success: true, data: null }), setInteractive: vi.fn(), postAction,
    } });
    try {
      render(createElement(BrowserChatApp));
      act(() => onContext?.(context(space("space-codex", "codex"))));
      fireEvent.click(screen.getByRole("button", { name: "Open app" }));
      expect(postAction).toHaveBeenLastCalledWith({ type: "openMcpApp", ownerKey: "draft", result: appResult, automatic: false });
      fireEvent.click(screen.getByRole("button", { name: "New app result" }));
      expect(postAction).toHaveBeenLastCalledWith({ type: "openMcpApp", ownerKey: "draft", result: appResult, automatic: true });
      act(() => onContext?.({ ...context(space("space-codex", "codex")), ownerKey: "run-owner" }));
      fireEvent.click(screen.getByRole("button", { name: "Open app" }));
      expect(postAction).toHaveBeenLastCalledWith({ type: "openMcpApp", ownerKey: "run-owner", result: appResult, automatic: false });
      expect(document.querySelector("iframe")).toBeNull();
    } finally { cleanup(); vi.unstubAllGlobals(); }
  });
  it("follows the parent Space when switching providers in the live child renderer", () => {
    let onContext: ((next: BrowserChatContext) => void) | undefined;
    vi.stubGlobal("api", {
      browserChat: {
        onContext: (callback: typeof onContext) => {
          onContext = callback;
          return vi.fn();
        },
        getContext: async () => ({ success: true, data: null }),
        setInteractive: vi.fn(),
      },
    });
    try {
      render(createElement(BrowserChatApp));
      expect(onContext).toBeDefined();
      act(() => onContext?.(context(space("space-codex", "codex"))));
      expect(screen.getByTestId("child-space").textContent).toBe("space-codex:codex");

      act(() => onContext?.(context(space("space-claude", "claude_code"))));
      expect(screen.getByTestId("child-space").textContent).toBe("space-claude:claude_code");
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});
