import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";

import { AsciiSpinner } from "@/components/ascii-spinner";
import { BotIcon, CheckIcon } from "@/components/desktop-icons";
import { ThemedText } from "@/components/themed-text";
import type { SessionSubagent } from "@/lib/subagents";
import { colors, radius, shadows, spacing, useBrandColors, useStatusColors } from "@/theme";

function statusText(agents: SessionSubagent[]): string {
  const running = agents.filter((agent) => agent.state === "running").length;
  const failed = agents.filter((agent) => agent.state === "failed").length;
  const stopped = agents.filter((agent) => agent.state === "stopped").length;
  if (running > 0) return `${running} running`;
  if (failed > 0) return `${failed} failed`;
  if (stopped > 0) return `${stopped} stopped`;
  return "Completed";
}

/** The main transcript's single gateway to every subagent in this run. */
export function SubagentSummaryRow({
  runId,
  agents,
}: {
  runId: string;
  agents: SessionSubagent[];
}) {
  const router = useRouter();
  const brand = useBrandColors();
  const statusColors = useStatusColors();
  const running = agents.some((agent) => agent.state === "running");
  const failed = agents.some((agent) => agent.state === "failed");
  const stopped = agents.some((agent) => agent.state === "stopped");
  const status = statusText(agents);
  const done = !running && !failed && !stopped;
  const statusTint = running
    ? statusColors.running
    : failed
      ? statusColors.failed
      : stopped
        ? statusColors.canceled
        : statusColors.done;

  return (
    /*
      Navigated by hand rather than with `<Link asChild>`. That path merges the
      link's props into the child through a Slot that *spreads* `style` — and a
      Pressable's style is a function of its pressed state, which spreads to
      nothing. The row lost every rule it had and fell back to a bare column.
    */
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Subagents, ${agents.length}, ${status}`}
      onPress={() => router.push({ pathname: "/subagents", params: { runId } } as Href)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.ms,
        paddingHorizontal: spacing.ms,
        paddingVertical: spacing.ms,
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: pressed ? colors.fill : colors.groupedCell,
        boxShadow: shadows.card,
      })}
    >
      {/* A fixed slot, so the title does not shift when the spinner gives way. */}
      <View style={{ width: 22, alignItems: "center", justifyContent: "center" }}>
        {running ? (
          <AsciiSpinner kind="square" size={14} color={brand.accent} />
        ) : (
          <BotIcon size={21} color={brand.accent} />
        )}
      </View>

      <View style={{ flex: 1, gap: spacing.xxs }}>
        <ThemedText variant="subhead" style={{ fontWeight: "600" }}>
          Subagents ({agents.length})
        </ThemedText>
        {done ? null : (
          <ThemedText variant="caption" numberOfLines={1} style={{ color: statusTint }}>
            {status}
          </ThemedText>
        )}
      </View>

      {/*
        Where the disclosure chevron would sit. Finished, the row has nothing
        left to say but that it finished — so the check takes the trailing
        place rather than adding a second line to say it in words, and the
        title stands alone. While there is still something to report, that
        line carries it and the trailing edge stays empty.
      */}
      {done ? <CheckIcon size={14} color={statusTint} /> : null}
    </Pressable>
  );
}
