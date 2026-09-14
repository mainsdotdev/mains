import { useLayoutEffect } from "react";
import { useAppSelector } from "@/lib/redux/hooks";
import {
  SIDEBAR_WIDTH_VAR,
  PANEL_WIDTH_VAR,
  BROWSER_PANEL_WIDTH_VAR,
  DOC_VIEWER_PANEL_WIDTH_VAR,
} from "@/lib/layout";

/** Imperatively write a layout width var on `:root` (used for live drag preview). */
export function setLayoutWidthVar(varName: string, width: number) {
  document.documentElement.style.setProperty(varName, `${width}px`);
}

/**
 * Mirrors the persisted sidebar / right-panel widths from the `appSettings`
 * slice onto their CSS custom properties on `:root`. Runs before paint so the
 * stored widths are restored without a flash on load. During an active drag the
 * handle writes the var directly (see `setLayoutWidthVar`); the commit on
 * release flows back through here as a no-op repaint.
 */
export function useLayoutWidthVars() {
  const sidebarWidth = useAppSelector((s) => s.appSettings.sidebarWidth);
  const rightPanelWidth = useAppSelector((s) => s.appSettings.rightPanelWidth);
  const browserPanelWidth = useAppSelector((s) => s.appSettings.browserPanelWidth);
  const documentViewerWidth = useAppSelector((s) => s.appSettings.documentViewerWidth);

  useLayoutEffect(() => {
    setLayoutWidthVar(SIDEBAR_WIDTH_VAR, sidebarWidth);
  }, [sidebarWidth]);

  useLayoutEffect(() => {
    setLayoutWidthVar(PANEL_WIDTH_VAR, rightPanelWidth);
  }, [rightPanelWidth]);

  useLayoutEffect(() => {
    setLayoutWidthVar(BROWSER_PANEL_WIDTH_VAR, browserPanelWidth);
  }, [browserPanelWidth]);

  useLayoutEffect(() => {
    setLayoutWidthVar(DOC_VIEWER_PANEL_WIDTH_VAR, documentViewerWidth);
  }, [documentViewerWidth]);
}
