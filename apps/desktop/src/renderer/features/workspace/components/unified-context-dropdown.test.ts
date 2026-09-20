// @vitest-environment jsdom

import { createElement, createRef } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedContextDropdown } from "./unified-context-dropdown";

vi.mock("@/lib/redux/api", () => ({
  useListProjectIssuesQuery: () => ({ data: [], isLoading: false }),
}));

const directory = {
  name: "components",
  fullPath: "/repo/src/components",
  type: "directory" as const,
  hasChildren: true,
};

function renderDropdown(overrides: { filterText?: string } = {}) {
  const onSelectFile = vi.fn();
  const onNavigateFile = vi.fn();
  const onClose = vi.fn();

  render(
    createElement(UnifiedContextDropdown, {
      isOpen: true,
      trigger: "@",
      filterText: overrides.filterText ?? "",
      workspacePath: "/repo",
      commands: [],
      skills: [],
      onSelectCommand: vi.fn(),
      onSelectSkill: vi.fn(),
      onSelectFile,
      onNavigateFile,
      onSelectIssue: vi.fn(),
      onClose,
      dropdownRef: createRef<HTMLDivElement>(),
    }),
  );

  return { onSelectFile, onNavigateFile, onClose };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UnifiedContextDropdown folders", () => {
  it("mentions a folder from the row and keeps browsing as a separate action", async () => {
    const listDir = vi.fn().mockResolvedValue({
      success: true,
      data: [directory],
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { fileExplorer: { listDir, searchFiles: vi.fn() } },
    });
    const user = userEvent.setup();
    const { onSelectFile, onNavigateFile, onClose } = renderDropdown();

    const folderRow = await screen.findByRole("menuitem", {
      name: /components/,
    });
    await user.click(folderRow);

    expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining(directory));
    expect(onNavigateFile).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("browses into a folder from its arrow without mentioning it", async () => {
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        fileExplorer: {
          listDir: vi.fn().mockResolvedValue({ success: true, data: [directory] }),
          searchFiles: vi.fn(),
        },
      },
    });
    const user = userEvent.setup();
    const { onSelectFile, onNavigateFile, onClose } = renderDropdown();

    const browseButton = await screen.findByRole("button", {
      name: "Browse components folder",
    });
    browseButton.focus();
    await user.keyboard("{Enter}");

    expect(onNavigateFile).toHaveBeenCalledWith("components/");
    expect(onSelectFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("requests directories when searching the whole workspace", async () => {
    const searchFiles = vi.fn().mockResolvedValue({
      success: true,
      data: [directory],
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        fileExplorer: { listDir: vi.fn(), searchFiles },
      },
    });
    renderDropdown({ filterText: "components" });

    await waitFor(() => {
      expect(searchFiles).toHaveBeenCalledWith({
        rootPath: "/repo",
        query: "components",
        max: 150,
        includeDirectories: true,
      });
    });
  });
});
