// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorContent } from "./editor-content";

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  signLocalImage: vi.fn(async (path: string) =>
    path.startsWith("/workspace/") ? "mains-localimg://img/?signed=1" : null,
  ),
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mocks.state),
}));

vi.mock("@/lib/redux/api", () => ({
  useGetWorkspaceQuery: () => ({ currentData: { rootPath: "/workspace" } }),
  useListReviewFindingsByWorkspaceQuery: () => ({}),
  useUpdateReviewFindingMutation: () => [vi.fn()],
}));

vi.mock("@/lib/diff-highlighter", () => ({
  useDiffHighlighterReady: () => false,
}));

vi.mock("@/lib/local-image-url", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/local-image-url")>(),
  signLocalImage: mocks.signLocalImage,
}));

function selectImageDiff(name: string) {
  const path = `assets/${name}`;
  const content = `diff --git a/${path} b/${path}\nnew file\nBinary or large file (128 bytes)\n`;
  mocks.state = {
    workspace: {
      activeWorkspaceId: "workspace-1",
      selectedFile: { name: `${name}.diff`, fullPath: path, type: "file", extension: "diff" },
      selectedFileContent: { content, size: content.length, isBinary: false, encoding: "utf-8" },
      isLoadingFileContent: false,
      fileContentError: null,
    },
  };
}

describe("EditorContent image preview", () => {
  afterEach(() => {
    cleanup();
    mocks.signLocalImage.mockClear();
  });

  it("shows a PNG instead of the binary-file placeholder", async () => {
    mocks.state = {
      workspace: {
        activeWorkspaceId: "workspace-1",
        selectedFile: {
          name: "icon.png",
          fullPath: "/workspace/icon.png",
          type: "file",
          extension: "png",
        },
        selectedFileContent: {
          content: "[Binary file - content cannot be displayed]",
          size: 296_653,
          isBinary: true,
          encoding: "binary",
        },
        isLoadingFileContent: false,
        fileContentError: null,
      },
    };

    render(createElement(EditorContent));

    const image = await screen.findByRole("img", { name: "icon.png" });
    expect(image.getAttribute("src")).toBe("mains-localimg://img/?signed=1");
    expect(mocks.signLocalImage).toHaveBeenCalledWith("/workspace/icon.png");
    expect(screen.queryByText("Preview not available for binary files")).toBeNull();
  });

  it("opens PNG diffs from the workspace root and clears errors when switching images", async () => {
    selectImageDiff("first.png");
    const { rerender } = render(createElement(EditorContent));

    const first = await screen.findByRole("img", { name: "first.png" });
    expect(mocks.signLocalImage).toHaveBeenCalledWith("/workspace/assets/first.png", undefined);
    fireEvent.error(first);
    expect(screen.getByText("Image failed to load")).toBeTruthy();

    selectImageDiff("second.png");
    rerender(createElement(EditorContent));
    const second = await screen.findByRole("img", { name: "second.png" });
    expect(second.getAttribute("src")).toBe("mains-localimg://img/?signed=1");
    expect(mocks.signLocalImage).toHaveBeenCalledWith("/workspace/assets/second.png", undefined);
  });
});
