import { useState } from "react";
import { Pressable, View } from "react-native";

import { accordionLabel, type TurnRow } from "@/lib/transcript-rows";
import type { TranscriptItem } from "@/lib/transcript";
import { colors, spacing } from "@/theme";

import { SFSymbol, ThemedText } from "@/components/ui";
import { TranscriptRow, type TranscriptActions, type TurnActions } from "./transcript-row";

/**
 * One planned row of the transcript: either a flat run of items, or a turn
 * whose earlier work is folded behind a "2 messages · 6 tool calls" line.
 *
 * The live rule is the desktop's: while the run is still inside this turn the
 * fold is forced open and its header hidden — you watch the work happen — and
 * the moment the turn settles it closes again, with the answer on top.
 */
export function TranscriptTurn({
  row,
  providerId,
  isRunInProgress,
  actions,
}: {
  row: TurnRow;
  providerId?: string | null;
  /** True only for the last row while the run is still going (see the screen). */
  isRunInProgress: boolean;
  /** Passed through untouched to whichever rows hold an agent message. */
  actions?: TranscriptActions;
}) {
  if (row.kind === "flat") {
    return <ItemList items={row.items} providerId={providerId} actions={actions} turn={turnOf(row.items)} />;
  }
  return (
    <TurnAccordion
      row={row}
      providerId={providerId}
      isRunInProgress={isRunInProgress}
      actions={actions}
    />
  );
}

/** What a turn's action row needs: which message ends the turn, and all of its text. */
function turnOf(items: TranscriptItem[]): TurnActions {
  const responses = items.filter((item) => item.kind === "response");
  return {
    lastResponseKey: responses.length > 0 ? responses[responses.length - 1].key : null,
    text: responses.map((item) => item.text).join("\n\n"),
  };
}

function ItemList({
  items,
  providerId,
  actions,
  turn,
}: {
  items: TranscriptItem[];
  providerId?: string | null;
  actions?: TranscriptActions;
  turn?: TurnActions;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      {items.map((item) => (
        <TranscriptRow key={item.key} item={item} providerId={providerId} actions={actions} turn={turn} />
      ))}
    </View>
  );
}

function TurnAccordion({
  row,
  providerId,
  isRunInProgress,
  actions,
}: {
  row: Extract<TurnRow, { kind: "accordion" }>;
  providerId?: string | null;
  isRunInProgress: boolean;
  actions?: TranscriptActions;
}) {
  const [open, setOpen] = useState(false);

  // A turn that goes live drops any earlier manual expansion, so the next
  // settle closes it rather than leaving it stuck open. Adjusted during render
  // off a remembered prop rather than in an effect — the desktop reaches for
  // `queueMicrotask` inside one to dodge the same cascading render.
  const [wasLive, setWasLive] = useState(isRunInProgress);
  if (wasLive !== isRunInProgress) {
    setWasLive(isRunInProgress);
    if (isRunInProgress) setOpen(false);
  }

  const expanded = isRunInProgress || open;
  const label = accordionLabel(row.messageCount, row.toolSummary);
  // The fold's messages and the closing one are one turn: one action row.
  const turn = turnOf([...row.previous, ...row.last]);

  return (
    <View style={{ gap: spacing.md }}>
      {!isRunInProgress && (
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.separator, paddingBottom: spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((v) => !v)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs + 2,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <ThemedText variant="footnote">{label}</ThemedText>
            <SFSymbol
              name={open ? "chevron.down" : "chevron.right"}
              size={11}
              tint={colors.tertiaryLabel}
            />
          </Pressable>
        </View>
      )}

      {expanded ? (
        <ItemList items={row.previous} providerId={providerId} actions={actions} turn={turn} />
      ) : null}
      {row.breakout.length > 0 ? (
        <ItemList items={row.breakout} providerId={providerId} actions={actions} turn={turn} />
      ) : null}
      <ItemList items={row.last} providerId={providerId} actions={actions} turn={turn} />
    </View>
  );
}
