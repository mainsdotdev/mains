// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFileContentLoader } from "./use-file-content-loader";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  readFileText: vi.fn(async () => ({ success: true, data: null })),
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
}));

vi.mock("@/lib/transport", () => ({
  appApi: { fileExplorer: { readFileText: mocks.readFileText } },
}));

describe("useFileContentLoader", () => {
  afterEach(() => {
    cleanup();
    mocks.dispatch.mockClear();
    mocks.readFileText.mockClear();
  });

  it("does not read an image as text", () => {
    renderHook(() =>
      useFileContentLoader(
        { type: "file", fullPath: "/workspace/icon.png", extension: "png" },
        "/workspace",
      ),
    );

    expect(mocks.readFileText).not.toHaveBeenCalled();
  });
});
