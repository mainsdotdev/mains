import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AsciiSpinner, SFSymbol, ThemedText } from "@/components/ui";
import { toPresentTense } from "@/lib/tool-registry";
import { type DiffLine } from "@/lib/tool-output";
import { colors, radius, spacing, useStatusColors } from "@/theme";

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
      <ThemedText variant="caption2" style={{ color: colors.systemGreen }}>
        +{added}
      </ThemedText>
      {"  "}
      <ThemedText variant="caption2" style={{ color: colors.systemRed }}>
        −{removed}
      </ThemedText>
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

/**
 * A patch, one tinted line per change. Unlike code output this wraps rather
 * than scrolling sideways: the tint has to reach both edges to read as a diff,
 * which it cannot do inside a horizontal scroller.
 */
export function ToolDiffBody({ lines }: { lines: DiffLine[] }) {
  const shown = lines.slice(0, MAX_BODY_LINES);
  const hidden = lines.length - shown.length;

  return (
    <BodyCard>
      {shown.map((line, i) => (
        <View
          key={i}
          style={{
            paddingHorizontal: spacing.ms,
            backgroundColor:
              line.type === "add"
                ? "rgba(52, 199, 89, 0.16)"
                : line.type === "remove"
                  ? "rgba(255, 59, 48, 0.16)"
                  : "transparent",
          }}
        >
          <ThemedText
            variant="mono"
            selectable
            style={{ color: line.type === "context" ? colors.secondaryLabel : colors.label }}
          >
            {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
            {line.text || " "}
          </ThemedText>
        </View>
      ))}
      {hidden > 0 ? <MoreLines count={hidden} /> : null}
    </BodyCard>
  );
}
