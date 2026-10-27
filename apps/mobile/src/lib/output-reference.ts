import { outputFileType } from "@mains/contracts/run-outputs";
import { isDesktopOnlyOutput } from "./output-presentation";

/** Resolve a local document link by its selected-output name, never as a phone path. */
export function outputReferenceName(href: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("file:") && !/^[A-Za-z]:[\\/]/.test(href)) return null;
  try {
    const value = decodeURIComponent(href.startsWith("file:") ? new URL(href).pathname : href)
      .replace(/#L\d+(?:-\d+)?$/, "").replace(/:\d+(?::\d+)?$/, "").split(/[?#]/)[0];
    const name = value.split(/[\\/]/).pop();
    return name && (isDesktopOnlyOutput({ name }) || outputFileType(name).previewType !== "unsupported") ? name : null;
  } catch { return null; }
}
