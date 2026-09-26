import { session } from "electron";
import {
  BROWSER_PREVIEW_SCHEME,
  serveBrowserPreview,
} from "./browser-preview";
import { BROWSER_PARTITION, browserService } from "./browser.service";

/** The browser view uses its own persistent session, not the default session. */
export function registerBrowserPreviewHandler(): void {
  session.fromPartition(BROWSER_PARTITION).protocol.handle(
    BROWSER_PREVIEW_SCHEME,
    (request) => serveBrowserPreview(
      new URL(request.url),
      (tabId) => browserService.getHtmlPreviewPath(tabId),
    ),
  );
}
