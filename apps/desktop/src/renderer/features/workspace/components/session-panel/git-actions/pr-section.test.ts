// @vitest-environment jsdom

import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrSection } from "./pr-section";
import type { GitActionsPanel, PendingAction } from "./use-git-actions-panel";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { CHANNELS } from "@mains/contracts/channels";
import { toastStore } from "@/components/ui";

const mediaInvoke = vi.fn();
const revokeUrl = vi.fn();

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
  const NativeURL = URL;
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = vi.fn(() => "blob:preview");
    static revokeObjectURL = revokeUrl;
  });
  mediaInvoke.mockImplementation(async (channel) => ({ success: true, data: channel === CHANNELS.gitFlow.stagePrAttachment ? { uploadId: "upload-1" } : undefined }));
  setTransport({ kind: "test", invoke: mediaInvoke, subscribe: () => () => undefined, status: () => "connected", onStatusChange: () => () => undefined } as Transport);
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
  resetTransport();
  mediaInvoke.mockReset();
  revokeUrl.mockReset();
  toastStore.dismissAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).startViewTransition;
  mutations.createPr.mockReset();
  mutations.generatePr.mockReset();
});

describe("pull request editor", () => {
  function MediaHarness({ onClose = () => undefined }: { onClose?: () => void }) {
    const [pending, setPending] = useState<PendingAction>(null);
    return createElement(PrSection, {
      panel: { workspaceId: "workspace-1", status: { branch: "feature", baseBranch: "main" }, isDefaultBranch: false,
        pending, setPending, busy: pending !== null, isSectionOpen: () => true, toggleSection: () => undefined } as unknown as GitActionsPanel,
      providerId: "codex", onClose, onEditorOpenChange: () => undefined, onEditorTransitionEnd: () => undefined,
    });
  }

  it("inserts at a remembered table selection, previews in the cell, and stages one file for repeated references", async () => {
    const user = userEvent.setup();
    render(createElement(MediaHarness));
    const body = "| Before | After |\n| --- | --- |\n| <!-- before --> | <!-- after --> |";
    let input = screen.getByRole("textbox", { name: "Pull request description" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: body } });
    input.focus();
    input.setSelectionRange(body.indexOf("<!-- before -->"), body.indexOf("<!-- before -->") + "<!-- before -->".length);
    fireEvent.select(input);
    // Moving fields must retain the selection even though the new textarea has never been focused.
    await user.click(screen.getByRole("button", { name: "Expand PR view" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.upload(dialog.getByLabelText("Attach images or videos"), new File(["image"], "before.png", { type: "image/png" }));
    input = dialog.getByRole("textbox", { name: "Pull request description" }) as HTMLTextAreaElement;
    expect(input.value).not.toContain("<!-- before -->");
    const firstReference = input.value.match(/!\[before.png\]\([^)]+\)/)![0];
    expect(input.value).toBe(body.replace("<!-- before -->", firstReference));
    input.focus();
    input.setSelectionRange(input.value.indexOf("<!-- after -->"), input.value.indexOf("<!-- after -->") + "<!-- after -->".length);
    fireEvent.select(input);
    await user.click(dialog.getByRole("button", { name: "Insert before.png at cursor" }));
    expect(input.value).toBe(body.replace("<!-- before -->", firstReference).replace("<!-- after -->", firstReference));
    await user.click(dialog.getByRole("tab", { name: "Preview" }));
    const table = dialog.getByRole("table");
    expect(within(table).getAllByRole("img", { name: "before.png" })).toHaveLength(2);
    expect(dialog.getAllByRole("img", { name: "before.png" })).toHaveLength(2);
    await user.click(dialog.getByRole("button", { name: "Create pull request" }));
    await waitFor(() => expect(mutations.createPr).toHaveBeenCalledOnce());
    expect(mutations.createPr).toHaveBeenCalledWith(expect.objectContaining({
      attachmentIds: ["upload-1"],
      body: body.replace("<!-- before -->", "![before.png](mains-pr-attachment:upload-1)").replace("<!-- after -->", "![before.png](mains-pr-attachment:upload-1)"),
    }));
  });

  it("previews GitHub HTML images with their dimensions and removes unsafe HTML", async () => {
    const user = userEvent.setup();
    render(createElement(MediaHarness));
    fireEvent.change(screen.getByRole("textbox", { name: "Pull request description" }), { target: { value:
      '| Before | After |\n| --- | --- |\n| <img width="456" height="165" alt="Before screenshot" src="https://github.com/user-attachments/assets/example" onerror="alert(1)" /> | Keep |\n\n<script>alert(1)</script><a href="javascript:alert(1)">Unsafe</a>' } });
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    const image = within(screen.getByRole("table")).getByRole("img", { name: "Before screenshot" });
    expect(image.getAttribute("width")).toBe("456");
    expect(image.getAttribute("height")).toBe("165");
    expect(image.getAttribute("src")).toBe("https://github.com/user-attachments/assets/example");
    expect(image.hasAttribute("onerror")).toBe(false);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("Unsafe").getAttribute("href")).toBeNull();
  });

  it("keeps a video link in the comparison cell and a player below the table", async () => {
    const user = userEvent.setup();
    render(createElement(MediaHarness));
    const body = "| Before | After |\n| --- | --- |\n| <!-- video --> | Keep |\n\n### Testing";
    const input = screen.getByRole("textbox", { name: "Pull request description" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: body } });
    input.focus();
    input.setSelectionRange(body.indexOf("<!-- video -->"), body.indexOf("<!-- video -->") + "<!-- video -->".length);
    fireEvent.select(input);
    await user.upload(screen.getByLabelText("Attach images or videos"), new File(["video"], "before.mp4", { type: "video/mp4" }));
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "before.mp4" })).toBeTruthy();
    expect(table.querySelector("video")).toBeNull();
    const player = screen.getByLabelText("before.mp4");
    expect(player.tagName).toBe("VIDEO");
    expect(player.hasAttribute("controls")).toBe(true);
    expect(screen.getByRole("heading", { name: "Testing" }).compareDocumentPosition(player) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    await user.click(within(table).getByRole("link", { name: "before.mp4" }));
    expect(document.querySelectorAll("video")).toHaveLength(1);
  });

  it("removes inserted references when their attachment is removed", async () => {
    const user = userEvent.setup();
    render(createElement(MediaHarness));
    await user.upload(screen.getByLabelText("Attach images or videos"), new File(["image"], "remove.png", { type: "image/png" }));
    const input = screen.getByRole("textbox", { name: "Pull request description" }) as HTMLTextAreaElement;
    expect(input.value).toContain("mains-pr-attachment:");
    await user.click(screen.getByRole("button", { name: "Remove remove.png" }));
    expect(input.value).toBe("");
  });

  it("accepts upload, paste and drop, keeps media across modal moves, and previews Markdown", async () => {
    const user = userEvent.setup();
    render(createElement(MediaHarness));
    await user.upload(screen.getByLabelText("Attach images or videos"), new File(["image"], "upload.png", { type: "image/png" }));
    const input = screen.getByRole("textbox", { name: "Pull request description" });
    fireEvent.change(input, { target: { value: "## Summary\n- [x] Done" } });
    fireEvent.paste(input, { clipboardData: { files: [new File(["paste"], "paste.png", { type: "image/png" })] } });
    fireEvent.drop(input, { dataTransfer: { types: ["Files"], files: [new File(["video"], "demo.mp4", { type: "video/mp4" })] } });
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Expand PR view" }));
    let dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("tab", { name: "Preview" }));
    expect(dialog.getByRole("heading", { name: "Summary" })).toBeTruthy();
    expect(dialog.getByRole("img", { name: "upload.png" })).toBeTruthy();
    expect(screen.getByRole("dialog").querySelector("video")).toBeTruthy();
    await user.click(dialog.getByRole("button", { name: "Minimize PR view" }));
    expect(screen.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Expand PR view" }));
    dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Remove demo.mp4" }));
    expect(dialog.queryByRole("button", { name: "Remove demo.mp4" })).toBeNull();
    expect(revokeUrl).toHaveBeenCalledOnce();
    expect(mediaInvoke).not.toHaveBeenCalled();
  });

  it("retains media on failure and closes once if the created PR has an upload warning", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(createElement(MediaHarness, { onClose }));
    await user.upload(screen.getByLabelText("Attach images or videos"), new File(["image"], "upload.png", { type: "image/png" }));
    mutations.createPr.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error("Permission denied")) });
    await user.click(screen.getAllByRole("button", { name: "Create pull request" })[1]);
    await waitFor(() => expect(toastStore.toasts.some((toast) => toast.message === "Permission denied")).toBe(true));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove upload.png" })).toBeTruthy();
    mutations.createPr.mockReturnValueOnce({ unwrap: () => Promise.resolve({ url: "", warning: "A video failed to upload." }) });
    await user.click(screen.getAllByRole("button", { name: "Create pull request" })[1]);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mutations.createPr).toHaveBeenLastCalledWith(expect.objectContaining({ attachmentIds: ["upload-1"] }));
    expect(toastStore.toasts.some((toast) => toast.message.includes("Pull request created. A video"))).toBe(true);
  });

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

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Minimize PR view" }));
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
