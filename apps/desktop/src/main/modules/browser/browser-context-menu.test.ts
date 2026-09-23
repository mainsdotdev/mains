import { describe, expect, it, vi } from "vitest";
import {
  buildBrowserContextMenu,
  type BrowserContextMenuActions,
} from "./browser-context-menu";

type MenuParams = Parameters<typeof buildBrowserContextMenu>[0];
type MenuState = Parameters<typeof buildBrowserContextMenu>[1];

function params(overrides: Partial<MenuParams> = {}): MenuParams {
  return {
    linkURL: "",
    srcURL: "",
    mediaType: "none",
    hasImageContents: false,
    isEditable: false,
    selectionText: "",
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canDelete: false,
      canSelectAll: false,
      canEditRichly: false,
    },
    x: 24,
    y: 42,
    ...overrides,
  };
}

function actions(): BrowserContextMenuActions {
  return {
    openTab: vi.fn(),
    openExternal: vi.fn(),
    download: vi.fn(),
    copyText: vi.fn(),
    copyImage: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    inspect: vi.fn(),
  };
}

const state: MenuState = {
  canGoBack: false,
  canGoForward: true,
  canInspect: false,
};

function labels(items: ReturnType<typeof buildBrowserContextMenu>) {
  return items.map((item) => item.label ?? "|");
}

function click(items: ReturnType<typeof buildBrowserContextMenu>, label: string) {
  const item = items.find((entry) => entry.label === label);
  expect(item?.click).toBeTypeOf("function");
  (item?.click as () => void)();
}

describe("browser context menu", () => {
  it("shows page navigation on blank page space", () => {
    const menu = buildBrowserContextMenu(params(), state, actions());
    expect(labels(menu)).toEqual(["Back", "Forward", "Reload"]);
    expect(menu[0].enabled).toBe(false);
    expect(menu[1].enabled).toBe(true);
  });

  it("offers separate link and image actions for a linked image", () => {
    const handlers = actions();
    const menu = buildBrowserContextMenu(
      params({
        linkURL: "https://mains.dev/download",
        srcURL: "https://mains.dev/logo.png",
        mediaType: "image",
        hasImageContents: true,
      }),
      { ...state, canInspect: true },
      handlers,
    );
    expect(labels(menu)).toEqual([
      "Open Link in New Tab",
      "Open Link in External Browser",
      "Download Link",
      "Copy Link Address",
      "|",
      "Open Image in New Tab",
      "Download Image",
      "Copy Image",
      "Copy Image Address",
      "|",
      "Inspect",
    ]);
    click(menu, "Open Link in New Tab");
    click(menu, "Open Link in External Browser");
    click(menu, "Download Image");
    click(menu, "Copy Image");
    click(menu, "Copy Image Address");
    click(menu, "Inspect");
    expect(handlers.openTab).toHaveBeenCalledWith("https://mains.dev/download");
    expect(handlers.openExternal).toHaveBeenCalledWith("https://mains.dev/download");
    expect(handlers.download).toHaveBeenCalledWith("https://mains.dev/logo.png");
    expect(handlers.copyImage).toHaveBeenCalledWith(24, 42);
    expect(handlers.copyText).toHaveBeenCalledWith("https://mains.dev/logo.png");
    expect(handlers.inspect).toHaveBeenCalledWith(24, 42);
  });

  it("does not open or download unsupported schemes", () => {
    const menu = buildBrowserContextMenu(
      params({
        linkURL: "javascript:alert(1)",
        srcURL: "data:image/png;base64,abc",
        mediaType: "image",
        hasImageContents: true,
      }),
      state,
      actions(),
    );
    expect(labels(menu)).toEqual([
      "Copy Link Address",
      "|",
      "Copy Image",
      "Copy Image Address",
    ]);
  });

  it("uses edit flags for text fields and allows copying selected page text", () => {
    const handlers = actions();
    const editable = buildBrowserContextMenu(
      params({
        isEditable: true,
        editFlags: { ...params().editFlags, canPaste: true },
      }),
      state,
      handlers,
    );
    expect(labels(editable)).toEqual([
      "Undo",
      "Redo",
      "|",
      "Cut",
      "Copy",
      "Paste",
      "|",
      "Select All",
    ]);
    expect(editable.find((item) => item.label === "Paste")?.enabled).toBe(true);
    click(editable, "Paste");
    expect(handlers.paste).toHaveBeenCalledOnce();

    const selected = buildBrowserContextMenu(
      params({ selectionText: "selected text" }),
      state,
      handlers,
    );
    expect(labels(selected)).toEqual(["Copy"]);
    click(selected, "Copy");
    expect(handlers.copy).toHaveBeenCalledOnce();
  });
});
