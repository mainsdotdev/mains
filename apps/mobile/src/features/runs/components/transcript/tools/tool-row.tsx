import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, useColorScheme } from "react-native";

import { AsciiSpinner, SFSymbol, ThemedText } from "@/components/ui";
import { toPresentTense } from "@/lib/tool-registry";
import { linesBetween, type Diff, type DiffHunk, type DiffLine } from "@/lib/tool-output";
import { wordEmphasis } from "@/lib/word-diff";
import {
  colors,
  radius,
  spacing,
  useSoftTint,
  useStatusColors,
  useSystemHues,
  withAlpha,
} from "@/theme";

/**
 * The shell every tool display sits in — the phone's answer to the desktop's
 * `ToolHeader` + `ToolCollapse` + `ToolOutputBody`.
 *
 * One tappable line: symbol, verb, the tool's own detail, an optional stat, and
 * a chevron when there is something to open. Status lives here rather than in
 * each display, so a call in flight spins and reads in the present tense
 * ("Reading…") wherever it appears.
 */

/** `tool_calls.status` as the Mac records it. */
export type ToolStatus = "queued" | "running" | "done" | "error" | "canceled" | string;

/**
 * Bodies never scroll: a nested vertical scroller inside the transcript's list
 * steals the drag. Long output is cut here and the remainder announced instead.
 */
const MAX_BODY_LINES = 40;

export function ToolRow({
  symbol,
  verb,
  status,
  detail,
  stat,
  error,
  children,
}: {
  symbol: string;
  verb: string;
  status: ToolStatus;
  /** The tool's own middle slot — a path, a command, a pattern. */
  detail?: ReactNode;
  /** Right-aligned counts — a string, or a node when it needs its own color. */
  stat?: ReactNode;
  error?: string | null;
  /** Expandable body; omitted when the call carries nothing to show. */
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusColors = useStatusColors();

  const running = status === "running" || status === "queued";
  const failed = status === "error" || status === "failed";
  const tint = failed ? statusColors.error : running ? statusColors.running : colors.secondaryLabel;
  const label = running ? toPresentTense(verb) : verb;
  const hasBody = Boolean(children);

  return (
    <View style={{ gap: spacing.xs }}>
      <Pressable
        accessibilityRole={hasBody ? "button" : undefined}
        accessibilityState={hasBody ? { expanded } : undefined}
        disabled={!hasBody}
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ width: 15, alignItems: "center" }}>
          {running ? (
            <AsciiSpinner kind="square" size={12} color={tint} />
          ) : (
            <SFSymbol name={symbol} size={14} tint={tint} />
          )}
        </View>

        <ThemedText variant="footnote" style={{ color: tint, fontWeight: "600" }}>
          {label}
          {running ? "…" : ""}
        </ThemedText>

        {detail ? <View style={{ flex: 1, minWidth: 0 }}>{detail}</View> : <View style={{ flex: 1 }} />}

        {stat ? (
          <ThemedText variant="caption2" numberOfLines={1}>
            {stat}
          </ThemedText>
        ) : null}

        {hasBody ? (
          <SFSymbol
            name={expanded ? "chevron.down" : "chevron.right"}
            size={11}
            tint={colors.tertiaryLabel}
          />
        ) : null}
      </Pressable>

      {error ? (
        <ThemedText variant="footnote" numberOfLines={3} style={{ color: colors.systemRed }}>
          {error}
        </ThemedText>
      ) : null}

      {expanded && hasBody ? children : null}
    </View>
  );
}

/** The detail slot's default treatment: one truncating, quiet line. */
export function ToolDetail({ children }: { children: string }) {
  return (
    <ThemedText variant="footnote" numberOfLines={1} style={{ color: colors.tertiaryLabel }}>
      {children}
    </ThemedText>
  );
}

/** A file-touching tool's `+5 −3`, in the colors a diff is read in. */
export function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <ThemedText variant="caption2">
      {added > 0 ? (
        <ThemedText variant="caption2" style={{ color: colors.systemGreen }}>
          +{added}
        </ThemedText>
      ) : null}
      {added > 0 && removed > 0 ? "  " : null}
      {removed > 0 ? (
        <ThemedText variant="caption2" style={{ color: colors.systemRed }}>
          −{removed}
        </ThemedText>
      ) : null}
    </ThemedText>
  );
}

/** The card every expanded body sits on. */
function BodyCard({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.secondarySystemBackground,
        borderRadius: radius.md,
        borderCurve: "continuous",
        paddingVertical: spacing.sm,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

function MoreLines({ count }: { count: number }) {
  return (
    <ThemedText variant="caption2" style={{ paddingHorizontal: spacing.ms, paddingTop: spacing.xs }}>
      +{count} more line{count === 1 ? "" : "s"}
    </ThemedText>
  );
}

/**
 * Monospaced output. Scrolls sideways rather than wrapping, so indentation and
 * columns survive; the vertical axis is capped, not scrolled.
 */
export function ToolCodeBody({ text }: { text: string }) {
  const all = text.split("\n");
  const shown = all.slice(0, MAX_BODY_LINES);
  const hidden = all.length - shown.length;

  return (
    <BodyCard>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ paddingHorizontal: spacing.ms }}>
          {shown.map((line, i) => (
            <ThemedText key={i} variant="mono" selectable style={{ color: colors.label }}>
              {line || " "}
            </ThemedText>
          ))}
        </View>
      </ScrollView>
      {hidden > 0 ? <MoreLines count={hidden} /> : null}
    </BodyCard>
  );
}

/** Prose output (a shell's own summary, an MCP text result) — wrapped, not scrolled. */
export function ToolTextBody({ text }: { text: string }) {
  return (
    <BodyCard>
      <View style={{ paddingHorizontal: spacing.ms }}>
        <ThemedText variant="footnote" selectable style={{ color: colors.label }}>
          {text}
        </ThemedText>
      </View>
    </BodyCard>
  );
}

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
export function ToolDiffBody({ diff }: { diff: Diff }) {
  const hues = useSystemHues();
  const soft = useSoftTint();
  const dark = useColorScheme() === "dark";
  const emphasis = (hue: string) => withAlpha(hue, dark ? 0.4 : 0.28);

  const { shown, hidden, gutterWidth } = useMemo(() => {
    let budget = MAX_BODY_LINES;
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
      hidden: total - (MAX_BODY_LINES - budget),
      // No numbers at all (an edit known only by its old/new strings) → no gutter.
      gutterWidth: highest > 0 ? Math.ceil(String(highest).length * MONO_CHAR_WIDTH) : 0,
    };
  }, [diff]);

  return (
    <BodyCard>
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
      {hidden > 0 ? <MoreLines count={hidden} /> : null}
    </BodyCard>
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
