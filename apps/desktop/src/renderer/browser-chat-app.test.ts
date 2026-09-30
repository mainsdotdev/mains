// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserChatContext } from "../shared/browser-chat-window";
import type { Space } from "../shared/space";
import { useActiveSpace } from "@/hooks/use-active-space";

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
    return createElement("output", { "data-testid": "child-space" },
      `${activeSpaceId}:${activeSpace?.providerId}`);
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
