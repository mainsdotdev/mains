import { outputFileType, type RunOutput } from "@mains/contracts/run-outputs";
import { isDesktopOnlyOutput } from "./output-presentation";
import type { TranscriptItem } from "./transcript";

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

/**
 * Names of the files this conversation is known to have delivered: its
 * selected-output cards and images in the loaded window, plus outputs the
 * phone has listed before.
 */
export function knownOutputNames(
  items: readonly TranscriptItem[],
  cached: readonly { descriptorJson: string }[],
): Set<string> {
  const names = new Set<string>();
  for (const item of items) {
    if (item.kind === "document") names.add(item.name);
    if (item.kind === "images") for (const image of item.images) names.add(image.fileName);
  }
  for (const row of cached) {
    try {
      const name = (JSON.parse(row.descriptorJson) as Partial<RunOutput>).name;
      if (typeof name === "string" && name) names.add(name);
    } catch { /* A damaged cache row names nothing. */ }
  }
  return names;
}

/**
 * Which local file references in one conversation become links: its known
 * outputs by name and, in Work/Chat, any Markdown file, which the backend can
 * still read from the run's own folder. Anything else — a Code run's
 * repository files above all — is a path the phone cannot open, so it stays
 * plain text rather than leading to an error.
 */
export function fileLinkFilter({ outputNames, markdownFallback }: {
  outputNames: ReadonlySet<string>;
  markdownFallback: boolean;
}): (filePath: string) => boolean {
  return (filePath) => {
    const name = outputReferenceName(filePath.trim());
    if (!name) return false;
    return outputNames.has(name) || (markdownFallback && /\.(?:md|markdown)$/i.test(name));
  };
}
