import { useState } from "react";
import { Pressable, View } from "react-native";

import { AsciiSpinner, SFSymbol, ThemedText } from "@/components/ui";
import type { ToolCallRow } from "@/db/schema";
import { mergeToolCalls, summarizeToolBlock } from "@/lib/tool-groups";
import { colors, spacing, useStatusColors } from "@/theme";

import { ToolCallDisplay } from "./tool-call-display";

/**
 * A stretch of consecutive tool calls, as one line that opens.
 *
 * Closed it reads "Worked for 24s · Read, Bash, Edit"; open it is the list of
 * rows the desktop shows inline. While the agent is still in the stretch the
 * block is open by default and its head names the tool in flight, so a live run
 * reads as progress rather than as a closed drawer — the same rule as the
 * desktop's turn accordion, which force-opens the running turn.
 */
export function ToolBlock({ calls }: { calls: ToolCallRow[] }) {
  const merged = mergeToolCalls(calls);
  if (merged.length === 1) return <ToolCallDisplay call={merged[0]} />;
  return <Block calls={merged} />;
}

function Block({ calls }: { calls: ToolCallRow[] }) {
  const summary = summarizeToolBlock(calls);
  const statusColors = useStatusColors();
  // Null until the user decides for themselves; then their choice sticks. Until
  // then the block follows the run — open while working, closed once done.
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? summary.running;

  const failed = calls.some((c) => c.status === "error" || c.status === "failed");
  const tint = failed
    ? statusColors.error
    : summary.running
      ? statusColors.running
      : colors.secondaryLabel;

  return (
    <View style={{ gap: spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${summary.label}, ${calls.length} tool calls`}
        accessibilityState={{ expanded }}
        onPress={() => setOverride(!expanded)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ width: 15, alignItems: "center" }}>
          {summary.running ? (
            <AsciiSpinner kind="square" size={12} color={tint} />
          ) : (
            <SFSymbol name={summary.symbol} size={14} tint={tint} />
          )}
        </View>

        <ThemedText variant="footnote" style={{ color: tint, fontWeight: "600" }}>
          {summary.label}
        </ThemedText>

        <ThemedText variant="caption2" numberOfLines={1} style={{ flex: 1 }}>
          {summary.tools}
        </ThemedText>

        <SFSymbol
          name={expanded ? "chevron.down" : "chevron.right"}
          size={11}
          tint={colors.tertiaryLabel}
        />
      </Pressable>

      {expanded ? (
        <View
          style={{
            gap: spacing.ms,
          }}
        >
          {calls.map((call) => (
            <ToolCallDisplay key={call.id} call={call} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
