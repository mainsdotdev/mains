// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionPanel } from "./session-panel";

const state = vi.hoisted(() => ({
  sessionPanelOpen: true,
  animationTargets: [] as boolean[],
  changeEditor: null as null | ((open: boolean, transitioning: boolean) => void),
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => (action: { payload: boolean }) => {
    state.sessionPanelOpen = action.payload;
  },
  useAppSelector: (selector: (value: unknown) => unknown) =>
    selector({
      appSettings: { sessionPanelOpen: state.sessionPanelOpen },
      workspace: { activeWorkspaceId: "workspace-1" },
    }),
}));

vi.mock("@/hooks/use-panel-animation", () => ({
  usePanelAnimation: (open: boolean) => {
    state.animationTargets.push(open);
    return { isVisible: open, isAnimatedIn: open };
  },
}));

vi.mock("@/hooks/use-mode-config", () => ({
  useModeConfig: () => ({
    showGitActions: true,
    showSources: false,
    showDeliverables: false,
  }),
}));

vi.mock("@/lib/platform", () => ({ useIsMobile: () => false }));

vi.mock("./git-actions", () => ({
  GitActionsSection: ({
    onPrEditorOpenChange,
  }: {
    onPrEditorOpenChange: (open: boolean, transitioning: boolean) => void;
  }) => {
    state.changeEditor = onPrEditorOpenChange;
    return null;
  },
}));

beforeEach(() => {
  state.sessionPanelOpen = true;
  state.animationTargets.length = 0;
  state.changeEditor = null;
});

afterEach(() => cleanup());

describe("session panel PR editor handoff", () => {
  it("closes the right panel while keeping the editor mounted, then restores it", () => {
    render(
      createElement(SessionPanel, {
        runId: null,
        laneOffset: "0rem",
        floating: true,
      }),
    );

    const panel = screen.getByRole("complementary", { name: "Session panel" });
    expect(state.changeEditor).not.toBeNull();

    act(() => state.changeEditor?.(true, false));
    expect(state.sessionPanelOpen).toBe(false);
    expect(state.animationTargets.at(-1)).toBe(true);
    expect(panel.isConnected).toBe(true);
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.style.opacity).toBe("0");

    act(() => state.changeEditor?.(false, false));
    expect(state.sessionPanelOpen).toBe(true);
    expect(panel.getAttribute("aria-hidden")).toBeNull();
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(panel.style.opacity).toBe("1");
  });
});
