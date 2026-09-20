// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import {
  addContextItem,
  clearContextItems,
  removeContextItem,
} from "@/lib/redux/slices/workspaceSlice";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  items: [] as ContextItem[],
  deleteAppshot: vi.fn(),
  deleteBrowserCapture: vi.fn(),
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (
    selector: (state: { workspace: { contextItems: ContextItem[] } }) => unknown,
  ) => selector({ workspace: { contextItems: mocks.items } }),
}));

import { useComposerContext } from "./use-composer-context";

const appshot: ContextItem = {
  kind: "appshot",
  id: "appshot-1",
  appName: "Preview",
  bundleIdentifier: "com.example.Preview",
  windowTitle: "Design",
  timestamp: "2026-09-18T12:00:00.000Z",
  screenshotPath: "/tmp/browser-captures/appshot-1.png",
  screenshotCaptureName: "appshot-1.png",
  screenshotMimeType: "image/png",
  accessibilityText: "Save",
  accessibilityStatus: "captured",
  accessibilityTruncated: false,
};

const browserSelection: ContextItem = {
  kind: "browser",
  id: "browser-1",
  url: "https://example.com",
  title: "Example",
  selector: "main",
  tagName: "main",
  text: "Hello",
  styles: {},
  rect: { x: 0, y: 0, width: 100, height: 100 },
  pageRect: { x: 0, y: 0, width: 100, height: 100 },
  scroll: { x: 0, y: 0 },
  viewport: { width: 800, height: 600 },
  devicePixelRatio: 2,
  timestamp: "2026-09-18T12:00:00.000Z",
  screenshotPath: "/tmp/browser-captures/browser-1.png",
  screenshotCaptureName: "browser-1.png",
  screenshotMimeType: "image/png",
};

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.deleteAppshot.mockReset().mockResolvedValue(null);
  mocks.deleteBrowserCapture.mockReset().mockResolvedValue(null);
  mocks.items = [];
  (window as any).api = {
    appshots: { deleteCapture: mocks.deleteAppshot },
    browser: { deleteCapture: mocks.deleteBrowserCapture },
  };
});

describe("useComposerContext capture lifetime", () => {
  it("does not delete sent captures when clearing composer state", () => {
    mocks.items = [appshot, browserSelection];
    const { result } = renderHook(() => useComposerContext());

    act(() => result.current.clear());

    expect(mocks.dispatch).toHaveBeenCalledWith(clearContextItems());
    expect(mocks.deleteAppshot).not.toHaveBeenCalled();
    expect(mocks.deleteBrowserCapture).not.toHaveBeenCalled();
  });

  it("deletes a capture when the user explicitly removes it", () => {
    mocks.items = [appshot];
    const { result } = renderHook(() => useComposerContext());

    act(() => result.current.remove(appshot));

    expect(mocks.dispatch).toHaveBeenCalledWith(
      removeContextItem({ kind: "appshot", key: appshot.id }),
    );
    expect(mocks.deleteAppshot).toHaveBeenCalledWith(
      appshot.screenshotCaptureName,
    );
  });

  it("keeps global Appshots while discarding route-scoped captures", () => {
    mocks.items = [browserSelection, appshot];
    const { result } = renderHook(() => useComposerContext());

    act(() => result.current.resetForRoute());

    expect(mocks.deleteBrowserCapture).toHaveBeenCalledWith(
      browserSelection.screenshotCaptureName,
    );
    expect(mocks.deleteAppshot).not.toHaveBeenCalled();
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      clearContextItems(),
      addContextItem(appshot),
    ]);
  });
});
