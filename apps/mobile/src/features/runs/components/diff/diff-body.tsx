import { Fragment, useMemo } from "react";
import { Text, View, useColorScheme } from "react-native";

import { ThemedText } from "@/components/ui";
import { linesBetween, type Diff, type DiffHunk, type DiffLine } from "@/lib/tool-output";
import { wordEmphasis } from "@/lib/word-diff";
import { useThemeColors, radius, spacing, useSoftTint, useSystemHues, withAlpha } from "@/theme";

/** Menlo's advance at the `mono` step's 13pt, for sizing the line-number gutter. */
const MONO_CHAR_WIDTH = 7.9;

/**
 * A patch as the desktop's diff viewer draws it, rebuilt from native views: a
 * bar and a wash on each changed row, the line's number in a gutter, a stronger
 * wash on the words that actually changed, and a quiet row where the patch
 * leaves lines out.
 *
 * Unlike code output this wraps rather than scrolling sideways: the wash has to
 * reach both edges to read as a diff, which it cannot do inside a horizontal
 * scroller. The gutter is its own column, so wrapped text stays aligned.
 */
export function DiffBody({ diff, maxLines }: { diff: Diff; maxLines?: number }) {
  const colors = useThemeColors();
  const hues = useSystemHues();
  const soft = useSoftTint();
  const dark = useColorScheme() === "dark";
  const emphasis = (hue: string) => withAlpha(hue, dark ? 0.4 : 0.28);

  const { shown, hidden, gutterWidth } = useMemo(() => {
    const limit = maxLines ?? Number.MAX_SAFE_INTEGER;
    let budget = limit;
    let total = 0;
    let highest = 0;
    const visible: { hunk: DiffHunk; lines: DiffLine[] }[] = [];
    for (const hunk of diff.hunks) {
      total += hunk.lines.length;
      if (budget <= 0) continue;
      const lines = hunk.lines.slice(0, budget);
      budget -= lines.length;
      for (const line of lines) highest = Math.max(highest, line.newNo ?? line.oldNo ?? 0);
      visible.push({ hunk, lines });
    }
    return {
      shown: visible.map((entry) => ({ ...entry, emphasis: wordEmphasis(entry.lines) })),
      hidden: total - (limit - budget),
      // No numbers at all (an edit known only by its old/new strings) → no gutter.
      gutterWidth: highest > 0 ? Math.ceil(String(highest).length * MONO_CHAR_WIDTH) : 0,
    };
  }, [diff, maxLines]);

  return (
    <View style={{ backgroundColor: colors.secondarySystemBackground, borderRadius: radius.md, borderCurve: "continuous", paddingVertical: spacing.sm, overflow: "hidden" }}>
      {shown.map(({ hunk, lines, emphasis: segmentsByLine }, h) => (
        <Fragment key={h}>
          {h > 0 ? <HunkGap count={linesBetween(shown[h - 1].hunk, hunk)} /> : null}
          {lines.map((line, i) => {
            const hue =
              line.type === "add" ? hues.green : line.type === "remove" ? hues.red : null;
            const segments = segmentsByLine[i];
            const number = line.newNo ?? line.oldNo;
            return (
              <View
                key={i}
                accessible
                accessibilityLabel={`${
                  line.type === "add" ? "Added: " : line.type === "remove" ? "Removed: " : ""
                }${line.text}`}
                style={{
                  flexDirection: "row",
                  backgroundColor: hue ? soft(hue) : "transparent",
                }}
              >
                <View style={{ width: 3, backgroundColor: hue ?? "transparent" }} />
                {gutterWidth > 0 ? (
                  <ThemedText
                    variant="mono"
                    style={{
                      width: gutterWidth,
                      marginLeft: spacing.sm,
                      textAlign: "right",
                      color: colors.tertiaryLabel,
                    }}
                  >
                    {number ?? ""}
                  </ThemedText>
                ) : null}
                <ThemedText
                  variant="mono"
                  selectable
                  style={{
                    flex: 1,
                    paddingHorizontal: spacing.ms,
                    color: line.type === "context" ? colors.secondaryLabel : colors.label,
                  }}
                >
                  {segments && hue
                    ? segments.map((segment, k) =>
                        segment.changed ? (
                          <Text key={k} style={{ backgroundColor: emphasis(hue) }}>
                            {segment.text}
                          </Text>
                        ) : (
                          segment.text
                        ),
                      )
                    : line.text || " "}
                </ThemedText>
              </View>
            );
          })}
        </Fragment>
      ))}
      {hidden > 0 ? <ThemedText variant="caption2" style={{ paddingHorizontal: spacing.ms, paddingTop: spacing.xs }}>+{hidden} more line{hidden === 1 ? "" : "s"}</ThemedText> : null}
    </View>
  );
}

/** Where a patch skips unchanged lines between two hunks. */
function HunkGap({ count }: { count: number | null }) {
  if (count === 0) return null;
  return (
    <ThemedText
      variant="caption2"
      style={{ paddingHorizontal: spacing.ms, paddingVertical: spacing.xs }}
    >
      {count === null ? "⋯" : `${count} unmodified line${count === 1 ? "" : "s"}`}
    </ThemedText>
  );
}
