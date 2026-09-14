import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { browserService } from "./browser.service";
import type { BrowserBounds } from "./browser.dto";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

function requireBounds(input: unknown): BrowserBounds {
  if (!input || typeof input !== "object") throw new Error("Invalid bounds");
  const b = input as Record<string, unknown>;
  const nums = ["x", "y", "width", "height"].map((k) => b[k]);
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new Error("Invalid bounds");
  }
  return {
    x: b.x as number,
    y: b.y as number,
    width: b.width as number,
    height: b.height as number,
  };
}

export function registerBrowserIpc(): void {
  ipcMain.handle(
    CHANNELS.browser.attach,
    handle((payload: unknown) => browserService.attach(requireBounds(payload))),
  );
  ipcMain.handle(
    CHANNELS.browser.detach,
    handle(() => browserService.detach()),
  );
  ipcMain.handle(
    CHANNELS.browser.destroy,
    handle(() => browserService.destroy()),
  );
  ipcMain.handle(
    CHANNELS.browser.setBounds,
    handle((payload: unknown) =>
      browserService.setBounds(requireBounds(payload)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.setVisible,
    handle((visible: unknown) => browserService.setVisible(Boolean(visible))),
  );
  ipcMain.handle(
    CHANNELS.browser.navigate,
    handle((url: unknown) => {
      if (typeof url !== "string") throw new Error("url must be a string");
      return browserService.navigate(url);
    }),
  );
  ipcMain.handle(
    CHANNELS.browser.back,
    handle(() => browserService.goBack()),
  );
  ipcMain.handle(
    CHANNELS.browser.forward,
    handle(() => browserService.goForward()),
  );
  ipcMain.handle(
    CHANNELS.browser.reload,
    handle(() => browserService.reload()),
  );
  ipcMain.handle(
    CHANNELS.browser.stop,
    handle(() => browserService.stop()),
  );
  ipcMain.handle(
    CHANNELS.browser.setSelectMode,
    handle((enabled: unknown) =>
      browserService.setSelectMode(Boolean(enabled)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.getNavState,
    handle(() => browserService.getNavState()),
  );
  ipcMain.handle(
    CHANNELS.browser.deleteCapture,
    handle((captureName: unknown) => {
      if (typeof captureName !== "string") {
        throw new Error("captureName must be a string");
      }
      return browserService.deleteCapture(captureName);
    }),
  );
}

export function unregisterBrowserIpc(): void {
  [
    CHANNELS.browser.attach,
    CHANNELS.browser.detach,
    CHANNELS.browser.destroy,
    CHANNELS.browser.setBounds,
    CHANNELS.browser.setVisible,
    CHANNELS.browser.navigate,
    CHANNELS.browser.back,
    CHANNELS.browser.forward,
    CHANNELS.browser.reload,
    CHANNELS.browser.stop,
    CHANNELS.browser.setSelectMode,
    CHANNELS.browser.getNavState,
    CHANNELS.browser.deleteCapture,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
