import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";
import { isAllowedBrowserUrl } from "../../../shared/browser-url";

type BrowserContextMenuParams = Pick<
  ContextMenuParams,
  | "linkURL"
  | "srcURL"
  | "mediaType"
  | "hasImageContents"
  | "isEditable"
  | "selectionText"
  | "editFlags"
  | "x"
  | "y"
>;

export interface BrowserContextMenuActions {
  openTab(url: string): void;
  openExternal(url: string): void;
  download(url: string): void;
  copyText(text: string): void;
  copyImage(x: number, y: number): void;
  undo(): void;
  redo(): void;
  cut(): void;
  copy(): void;
  paste(): void;
  selectAll(): void;
  back(): void;
  forward(): void;
  reload(): void;
  inspect(x: number, y: number): void;
}

interface BrowserContextMenuState {
  canGoBack: boolean;
  canGoForward: boolean;
  canInspect: boolean;
}

function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Build only actions that make sense for the element under the pointer. */
export function buildBrowserContextMenu(
  params: BrowserContextMenuParams,
  state: BrowserContextMenuState,
  actions: BrowserContextMenuActions,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const appendGroup = (group: MenuItemConstructorOptions[]) => {
    if (group.length === 0) return;
    if (items.length > 0) items.push({ type: "separator" });
    items.push(...group);
  };

  if (params.isEditable) {
    appendGroup([
      { label: "Undo", enabled: params.editFlags.canUndo, click: actions.undo },
      { label: "Redo", enabled: params.editFlags.canRedo, click: actions.redo },
      { type: "separator" },
      { label: "Cut", enabled: params.editFlags.canCut, click: actions.cut },
      { label: "Copy", enabled: params.editFlags.canCopy, click: actions.copy },
      { label: "Paste", enabled: params.editFlags.canPaste, click: actions.paste },
      { type: "separator" },
      {
        label: "Select All",
        enabled: params.editFlags.canSelectAll,
        click: actions.selectAll,
      },
    ]);
  } else if (params.selectionText) {
    appendGroup([{ label: "Copy", click: actions.copy }]);
  }

  if (params.linkURL) {
    const linkItems: MenuItemConstructorOptions[] = [];
    if (isAllowedBrowserUrl(params.linkURL)) {
      linkItems.push({
        label: "Open Link in New Tab",
        click: () => actions.openTab(params.linkURL),
      });
    }
    if (isWebUrl(params.linkURL)) {
      linkItems.push(
        {
          label: "Open Link in External Browser",
          click: () => actions.openExternal(params.linkURL),
        },
        {
          label: "Download Link",
          click: () => actions.download(params.linkURL),
        },
      );
    }
    linkItems.push({
      label: "Copy Link Address",
      click: () => actions.copyText(params.linkURL),
    });
    appendGroup(linkItems);
  }

  if (params.mediaType === "image") {
    const imageItems: MenuItemConstructorOptions[] = [];
    if (isWebUrl(params.srcURL)) {
      imageItems.push(
        {
          label: "Open Image in New Tab",
          click: () => actions.openTab(params.srcURL),
        },
        {
          label: "Download Image",
          click: () => actions.download(params.srcURL),
        },
      );
    }
    if (params.hasImageContents) {
      imageItems.push({
        label: "Copy Image",
        click: () => actions.copyImage(params.x, params.y),
      });
    }
    if (params.srcURL) {
      imageItems.push({
        label: "Copy Image Address",
        click: () => actions.copyText(params.srcURL),
      });
    }
    appendGroup(imageItems);
  }

  if (items.length === 0) {
    appendGroup([
      { label: "Back", enabled: state.canGoBack, click: actions.back },
      { label: "Forward", enabled: state.canGoForward, click: actions.forward },
      { label: "Reload", click: actions.reload },
    ]);
  }

  if (state.canInspect) {
    appendGroup([
      { label: "Inspect", click: () => actions.inspect(params.x, params.y) },
    ]);
  }

  return items;
}
