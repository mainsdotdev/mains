interface DesktopSourceLike {
  id: string;
  name: string;
}

export interface FrontmostWindow {
  appName: string;
  bundleIdentifier: string | null;
  processId: number;
  windowId: number;
  windowTitle: string;
}

export function parseFrontmostWindow(raw: string): FrontmostWindow {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    throw new Error("Could not identify the frontmost window");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Could not identify the frontmost window");
  }
  const record = value as Record<string, unknown>;
  const processId = Number(record.processId);
  const windowId = Number(record.windowId);
  if (
    typeof record.appName !== "string" ||
    record.appName.trim() === "" ||
    !Number.isInteger(processId) ||
    processId <= 0 ||
    !Number.isInteger(windowId) ||
    windowId <= 0
  ) {
    throw new Error("The frontmost app does not have a capturable window");
  }
  return {
    appName: record.appName.trim(),
    bundleIdentifier:
      typeof record.bundleIdentifier === "string" && record.bundleIdentifier
        ? record.bundleIdentifier
        : null,
    processId,
    windowId,
    windowTitle:
      typeof record.windowTitle === "string" ? record.windowTitle.trim() : "",
  };
}

/** Electron source ids are `window:<CGWindowID>:<display id>`. */
export function sourceWindowId(sourceId: string): number | null {
  const match = /^window:(\d+):/.exec(sourceId);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function findWindowSource<T extends DesktopSourceLike>(
  sources: readonly T[],
  window: Pick<FrontmostWindow, "windowId">,
): T | null {
  return sources.find(
    (source) => sourceWindowId(source.id) === window.windowId,
  ) ?? null;
}
