const MIN_PLACEHOLDER_HEIGHT = 96;
const MAX_PLACEHOLDER_HEIGHT = 2400;

/**
 * Reserve roughly the final message height while its DOM renderer boots.
 * Exact measurement still comes from the WebView; this estimate only keeps
 * following transcript rows from temporarily collapsing into its place.
 */
export function estimateMathMarkdownHeight(
  source: string,
  contentWidth: number,
  fontScale: number,
): number {
  const safeScale = Math.max(0.8, fontScale);
  const averageGlyphWidth = 8 * safeScale;
  const charactersPerLine = Math.max(18, Math.floor(contentWidth / averageGlyphWidth));
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let visualRows = 0;
  let paragraphGaps = 0;
  let inDisplayMath = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "$$") {
      if (!inDisplayMath) visualRows += 2.8;
      inDisplayMath = !inDisplayMath;
      continue;
    }
    if (inDisplayMath) continue;
    if (!trimmed) {
      paragraphGaps += 0.45;
      continue;
    }

    // TeX command names are much longer than their rendered glyphs. Reduce
    // them before estimating wraps so equations do not reserve huge blanks.
    const visibleText = trimmed
      .replace(/\\[A-Za-z]+/g, "x")
      .replace(/[`*_#>~{}$[\]]/g, "")
      .replace(/^\s*(?:[-+] |\d+[.)]\s+)/, "");
    visualRows += Math.max(1, Math.ceil(visibleText.length / charactersPerLine));
  }

  const lineHeight = 24 * safeScale;
  const estimated = Math.ceil((visualRows + paragraphGaps) * lineHeight + 8);
  return Math.min(MAX_PLACEHOLDER_HEIGHT, Math.max(MIN_PLACEHOLDER_HEIGHT, estimated));
}
