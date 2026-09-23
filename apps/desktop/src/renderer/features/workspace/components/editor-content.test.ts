// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorContent } from "./editor-content";

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  signLocalImage: vi.fn(async () => "mains-localimg://img/?signed=1"),
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mocks.state),
}));

vi.mock("@/lib/local-image-url", () => ({
  signLocalImage: mocks.signLocalImage,
}));

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
});
