// @vitest-environment jsdom

import { createElement, useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrSection } from "./pr-section";
import type { GitActionsPanel, PendingAction } from "./use-git-actions-panel";

const mutations = vi.hoisted(() => ({
  createPr: vi.fn(),
  generatePr: vi.fn(),
}));

vi.mock("@/lib/redux/api", () => ({
  useCreatePrGitFlowMutation: () => [mutations.createPr],
  useGeneratePrBodyGitFlowMutation: () => [mutations.generatePr, { isLoading: false }],
  useGetWorkspaceQuery: () => ({ data: { projectId: "project-1" } }),
  useListProjectBranchesQuery: () => ({ data: ["main", "release"] }),
}));

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
    [{}] as unknown as DOMRectList,
  );
  mutations.createPr.mockReturnValue({
    unwrap: () => Promise.resolve({ url: null }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).startViewTransition;
  mutations.createPr.mockReset();
  mutations.generatePr.mockReset();
});

describe("pull request editor", () => {
  it("keeps the draft while moving between the panel and modal, then submits it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onEditorOpenChange = vi.fn();

    function Harness() {
      const [isOpen, setIsOpen] = useState(false);
      const [pending, setPending] = useState<PendingAction>(null);
      const panel = {
        workspaceId: "workspace-1",
        status: { branch: "feature", baseBranch: "main" },
        isDefaultBranch: false,
        pending,
        setPending,
        busy: pending !== null,
        isSectionOpen: (section: string) => section === "pr" && isOpen,
        toggleSection: () => setIsOpen((value) => !value),
      } as unknown as GitActionsPanel;
      return createElement(PrSection, {
        panel,
        providerId: "codex",
        onClose,
        onEditorOpenChange,
        onEditorTransitionEnd: () => undefined,
      });
    }

    render(createElement(Harness));
    await user.click(screen.getByRole("button", { name: "Create pull request", expanded: false }));
    await user.type(screen.getByRole("textbox", { name: "Pull request title" }), "A title");
    await user.type(
      screen.getByRole("textbox", { name: "Pull request description" }),
      "A description",
    );
    await user.click(screen.getByRole("button", { name: "Expand PR view" }));
    expect(onEditorOpenChange).toHaveBeenLastCalledWith(true, false);

    const dialog = screen.getByRole("dialog", { name: "Create pull request" });
    expect((within(dialog).getByRole("textbox", { name: "Pull request title" }) as HTMLInputElement).value).toBe("A title");
    expect((within(dialog).getByRole("textbox", { name: "Pull request description" }) as HTMLTextAreaElement).value).toBe("A description");

    await user.click(within(dialog).getByRole("checkbox", { name: "Create as draft" }));
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Minimize PR view" }));
    expect(onEditorOpenChange).toHaveBeenLastCalledWith(false, false);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Pull request title" }) as HTMLInputElement).value).toBe("A title");
    expect((screen.getByRole("textbox", { name: "Pull request description" }) as HTMLTextAreaElement).value).toBe("A description");
    expect((screen.getByRole("checkbox", { name: "Create as draft" }) as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Expand PR view" }));

    await user.click(screen.getByRole("button", { name: "Expand PR view" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create pull request" }));

    await waitFor(() => expect(mutations.createPr).toHaveBeenCalledOnce());
    expect(mutations.createPr).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      title: "A title",
      body: "A description",
      base: "main",
      draft: true,
      providerId: "codex",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("pairs the panel form and modal in both directions when view transitions are available", async () => {
    const user = userEvent.setup();
    const onEditorOpenChange = vi.fn();
    const onEditorTransitionEnd = vi.fn();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        finished: Promise.resolve(),
        skipTransition: vi.fn(),
      } as unknown as ViewTransition;
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    const panel = {
      workspaceId: "workspace-1",
      status: { branch: "feature", baseBranch: "main" },
      isDefaultBranch: false,
      pending: null,
      setPending: vi.fn(),
      busy: false,
      isSectionOpen: () => true,
      toggleSection: vi.fn(),
    } as unknown as GitActionsPanel;
    render(
      createElement(PrSection, {
        panel,
        providerId: "codex",
        onClose: vi.fn(),
        onEditorOpenChange,
        onEditorTransitionEnd,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Expand PR view" }));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(onEditorOpenChange).toHaveBeenLastCalledWith(true, true);

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Back to panel" }));
    expect(startViewTransition).toHaveBeenCalledTimes(2);
    expect(onEditorOpenChange).toHaveBeenLastCalledWith(false, true);
    await waitFor(() => expect(onEditorTransitionEnd).toHaveBeenCalledTimes(2));
  });

  it("restores the panel if git status makes the PR unavailable", async () => {
    const user = userEvent.setup();
    const onEditorOpenChange = vi.fn();

    function Harness() {
      const [onDefaultBranch, setOnDefaultBranch] = useState(false);
      const [rowOpen, setRowOpen] = useState(true);
      const panel = {
        workspaceId: "workspace-1",
        status: { branch: "feature", baseBranch: "main" },
        isDefaultBranch: onDefaultBranch,
        pending: null,
        setPending: vi.fn(),
        busy: false,
        isSectionOpen: () => rowOpen,
        toggleSection: () => setRowOpen((value) => !value),
      } as unknown as GitActionsPanel;
      return createElement(
        "div",
        null,
        createElement(
          "button",
          { onClick: () => setOnDefaultBranch((value) => !value) },
          "Change branch status",
        ),
        createElement(PrSection, {
          panel,
          onClose: vi.fn(),
          onEditorOpenChange,
          onEditorTransitionEnd: () => undefined,
        }),
      );
    }

    render(createElement(Harness));
    await user.click(screen.getByRole("button", { name: "Expand PR view" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Change branch status" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onEditorOpenChange).toHaveBeenLastCalledWith(false, false);

    await user.click(screen.getByRole("button", { name: "Change branch status" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
