import { and, asc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { backendSession, useSession } from "@/backend/backend-session";
import { AsciiSpinner, SFSymbol, ThemedText } from "@/components/ui";
import { db } from "@/db/client";
import { runArtifacts, toolCalls, type ToolCallRow } from "@/db/schema";
import { formatDuration } from "@/lib/format";
import {
  buildSubagentFlow,
  selectSessionSubagents,
  selectSubagentReport,
  subagentDisplay,
  subagentWorkedMs,
  toolCallMetadata,
  type SessionSubagent,
  type SubagentState,
} from "@/lib/subagents";
import { Markdown } from "../transcript/markdown";
import { ToolCallDisplay } from "../transcript/tools/tool-call-display";
import { colors, radius, shadows, spacing, useBrandColors, useStatusColors } from "@/theme";

function stateLabel(state: SubagentState): string {
  switch (state) {
    case "running":
      return "Running";
    case "done":
      return "Completed";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}

function StateMark({ state }: { state: SubagentState }) {
  const statusColors = useStatusColors();
  if (state === "running") {
    return <AsciiSpinner kind="square" size={13} color={statusColors.running} />;
  }
  const symbol =
    state === "done"
      ? "checkmark.circle.fill"
      : state === "failed"
        ? "xmark.circle.fill"
        : "stop.circle.fill";
  const tint =
    state === "done"
      ? statusColors.done
      : state === "failed"
        ? statusColors.failed
        : statusColors.canceled;
  return <SFSymbol name={symbol} size={16} tint={tint} />;
}

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <HeaderButton
        label={onBack ? "Back to subagents" : "Close"}
        symbol={onBack ? "chevron.left" : "xmark"}
        onPress={onBack ?? (() => router.back())}
      />
      <ThemedText variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: "center" }}>
        {title}
      </ThemedText>
      {onBack ? (
        <HeaderButton label="Close" symbol="xmark" onPress={() => router.back()} />
      ) : (
        <View style={{ width: 40 }} />
      )}
    </View>
  );
}

function HeaderButton({
  label,
  symbol,
  onPress,
}: {
  label: string;
  symbol: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.fill,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <SFSymbol name={symbol} size={16} tint={colors.label} />
    </Pressable>
  );
}

/** Native sheet containing the run's subagent list and drill-in detail. */
export function SubagentsSheet() {
  const { runId: param } = useLocalSearchParams<{ runId: string }>();
  const runId = typeof param === "string" ? param : "";
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!runId) return;
      backendSession.openRun(runId);
      return () => backendSession.closeRun(runId);
    }, [runId]),
  );

  const callQuery = useLiveQuery(
    db
      .select()
      .from(toolCalls)
      .where(and(eq(toolCalls.backendId, backendId), eq(toolCalls.runId, runId)))
      .orderBy(asc(toolCalls.createdAt), asc(toolCalls.id)),
    [backendId, runId],
  );
  const artifactQuery = useLiveQuery(
    db
      .select()
      .from(runArtifacts)
      .where(and(eq(runArtifacts.backendId, backendId), eq(runArtifacts.runId, runId)))
      .orderBy(asc(runArtifacts.createdAt), asc(runArtifacts.id)),
    [backendId, runId],
  );

  const agents = useMemo(() => selectSessionSubagents(callQuery.data), [callQuery.data]);
  const selected = agents.find((agent) => agent.id === selectedId);

  if (selected) {
    return (
      <SubagentDetail
        agent={selected}
        calls={callQuery.data}
        artifacts={artifactQuery.data}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.md,
        paddingTop: spacing.ms,
        paddingBottom: spacing.xxl,
        gap: spacing.md,
      }}
    >
      <Header title={`Subagents (${agents.length})`} />
      {agents.length > 0 ? (
        <View
          style={{
            borderRadius: radius.lg,
            borderCurve: "continuous",
            backgroundColor: colors.groupedCell,
            boxShadow: shadows.card,
            overflow: "hidden",
          }}
        >
          {agents.map((agent, index) => (
            <SubagentRow
              key={agent.id}
              agent={agent}
              first={index === 0}
              onPress={() => setSelectedId(agent.id)}
            />
          ))}
        </View>
      ) : (
        <ThemedText variant="subhead" style={{ color: colors.secondaryLabel, textAlign: "center" }}>
          No subagents in this run.
        </ThemedText>
      )}
    </ScrollView>
  );
}

function SubagentRow({
  agent,
  first,
  onPress,
}: {
  agent: SessionSubagent;
  first: boolean;
  onPress: () => void;
}) {
  const brand = useBrandColors();
  const display = subagentDisplay(agent);
  return (
    <View>
      {!first ? (
        <View style={{ height: 1, marginLeft: 56, backgroundColor: colors.separator }} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${display.name}, ${stateLabel(agent.state)}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.ms,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.ms,
          backgroundColor: pressed ? colors.fill : "transparent",
        })}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.full,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: brand.accentSoft,
          }}
        >
          <SFSymbol name="person.fill" size={13} tint={brand.accent} />
        </View>
        <View style={{ flex: 1, gap: spacing.xxs }}>
          <ThemedText variant="body" numberOfLines={1}>
            {display.name}
          </ThemedText>
          <ThemedText variant="footnote" numberOfLines={1} style={{ color: colors.secondaryLabel }}>
            {[display.detail, stateLabel(agent.state)].filter(Boolean).join(" · ")}
          </ThemedText>
        </View>
        <StateMark state={agent.state} />
        <SFSymbol name="chevron.right" size={12} tint={colors.tertiaryLabel} />
      </Pressable>
    </View>
  );
}

function SubagentDetail({
  agent,
  calls,
  artifacts,
  onBack,
}: {
  agent: SessionSubagent;
  calls: ToolCallRow[];
  artifacts: (typeof runArtifacts.$inferSelect)[];
  onBack: () => void;
}) {
  const display = subagentDisplay(agent);
  const spawn = calls.find((call) => call.id === agent.id);
  const { subagent, task } = spawn ? toolCallMetadata(spawn) : {};
  const flow = useMemo(
    () => buildSubagentFlow({ agent, calls, artifacts }),
    [agent, artifacts, calls],
  );
  const report = selectSubagentReport(subagent?.result ?? task?.summary, flow);
  const workedMs = spawn ? subagentWorkedMs(spawn) : undefined;
  const error = subagent?.error ?? task?.error;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.md,
        paddingTop: spacing.ms,
        paddingBottom: spacing.xxl,
        gap: spacing.md,
      }}
    >
      <Header title={display.name} onBack={onBack} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <StateMark state={agent.state} />
        <ThemedText variant="footnote" style={{ color: colors.secondaryLabel }}>
          {stateLabel(agent.state)}
          {workedMs !== undefined ? ` · ${formatDuration(workedMs)}` : ""}
        </ThemedText>
      </View>

      {display.detail ? (
        <ThemedText variant="footnote" style={{ color: colors.secondaryLabel }}>
          {display.detail}
        </ThemedText>
      ) : null}

      {subagent?.prompt ? (
        <View
          style={{
            padding: spacing.ms,
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: colors.groupedCell,
            boxShadow: shadows.card,
          }}
        >
          <ThemedText variant="subhead" selectable>
            {subagent.prompt}
          </ThemedText>
        </View>
      ) : null}

      {flow.length === 0 && !report && !error ? (
        <ThemedText variant="subhead" style={{ color: colors.secondaryLabel }}>
          {agent.state === "running"
            ? "No activity recorded yet."
            : "No activity was recorded for this agent."}
        </ThemedText>
      ) : null}

      <View style={{ gap: spacing.ms }}>
        {flow.map((item) => {
          if (item.kind === "tool") {
            return <ToolCallDisplay key={item.key} call={item.call} />;
          }
          if (item.kind === "message") {
            return <Markdown key={item.key} source={item.content} />;
          }
          return (
            <View
              key={item.key}
              style={{
                padding: spacing.ms,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: colors.fill,
              }}
            >
              <ThemedText variant="subhead" selectable>
                {item.content}
              </ThemedText>
            </View>
          );
        })}
      </View>

      {report ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.separator, paddingTop: spacing.md }}>
          <Markdown source={report} />
        </View>
      ) : null}

      {error ? (
        <ThemedText variant="subhead" selectable style={{ color: colors.systemRed }}>
          {error}
        </ThemedText>
      ) : null}
    </ScrollView>
  );
}
