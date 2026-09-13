import { and, asc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { FullWindowOverlay } from "react-native-screens";

import { backendSession } from "@/backend/backend-session";
import type { ContextSourcesResult } from "@/backend/sync";
import { commands as commandsTable, skills as skillsTable } from "@/db/schema";
import { db } from "@/db/client";
import {
  buildPickerSections,
  scopeLabel,
  type ContextBucket,
  type ContextTrigger,
  type PickerRow,
} from "@/lib/context-picker";
import type { CommandRow, SkillRow } from "@/db/schema";
import { colors, radius, shadows, spacing, useSoftTint } from "@/theme";

import { SFSymbol, ThemedText } from "@/components/ui";

/**
 * The composer's context menu, as a sheet.
 *
 * Anchored above the composer rather than presented as a modal sheet, for one
 * reason: a modal takes focus, the keyboard drops, and typing to filter — the
 * whole point of the desktop's dropdown — stops working. So this is what the
 * desktop is: a panel over the input, with the keyboard still up.
 *
 * What is listed, how it is bucketed and how the filter behaves are the
 * desktop's rules, ported in `lib/context-picker.ts`.
 */
export function ContextPicker({
  visible,
  backendId,
  providerId,
  workspacePath,
  trigger,
  bucket = null,
  filter,
  maxHeight,
  overlayBottom = null,
  onSelect,
  onClose,
}: {
  visible: boolean;
  backendId: string;
  providerId: string;
  /** Scopes the listing; a provider may answer differently without one. */
  workspacePath?: string | null;
  trigger: ContextTrigger;
  bucket?: ContextBucket | null;
  filter: string;
  /** As tall as the room above the bar allows (the bar works this out). */
  maxHeight: number;
  /**
   * Presents the picker in a full-window dismiss layer at this distance from
   * the screen bottom. Used by the + menu's plugin-only picker; inline typed
   * triggers stay local so the keyboard keeps focus while filtering.
   */
  overlayBottom?: number | null;
  onSelect: (row: PickerRow) => void;
  onClose: () => void;
}) {
  const skillQuery = useLiveQuery(
    db
      .select()
      .from(skillsTable)
      .where(and(eq(skillsTable.backendId, backendId), eq(skillsTable.providerId, providerId)))
      .orderBy(asc(skillsTable.sortOrder)),
    [backendId, providerId],
  );
  const commandQuery = useLiveQuery(
    db
      .select()
      .from(commandsTable)
      .where(and(eq(commandsTable.backendId, backendId), eq(commandsTable.providerId, providerId)))
      .orderBy(asc(commandsTable.sortOrder)),
    [backendId, providerId],
  );

  const sections = useMemo(
    () =>
      buildPickerSections({
        skills: skillQuery.data,
        commands: commandQuery.data,
        trigger,
        bucket,
        filter,
      }),
    [skillQuery.data, commandQuery.data, trigger, bucket, filter],
  );

  // The snapshot lists these once per connection; re-ask on open so a plugin
  // installed on the Mac since then shows up.
  // Tagged with what was asked rather than cleared when the ask changes: a
  // synchronous reset inside the effect is the cascading render the lint rule
  // is about, and comparing the tag discards a stale answer just as well.
  const request = `${providerId}|${workspacePath ?? ""}`;
  const [answered, setAnswered] = useState<{
    request: string;
    result: ContextSourcesResult | null;
  } | null>(null);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void backendSession.refreshContextSources(providerId, workspacePath).then((result) => {
      if (!cancelled) setAnswered({ request, result });
    });
    return () => {
      cancelled = true;
    };
  }, [visible, providerId, workspacePath, request]);
  const outcome = answered?.request === request ? answered.result : null;

  // An empty list has three quite different causes, and the rows cannot tell
  // them apart: the Mac refused the call, the provider genuinely offers
  // nothing, or the filter simply matched nothing. Say which.
  const empty = filter
    ? "No matches"
    : outcome?.error
      ? `Couldn't load them — ${outcome.error}`
      : outcome && outcome.skills === 0 && outcome.commands === 0
        ? `${providerId} offers no skills or commands${
            workspacePath ? "" : " — no workspace is selected, so project ones are out of reach"
          }`
        : bucket === "plugins"
          ? "No plugins installed"
          : trigger === "$"
            ? "No skills available"
            : "Loading…";

  if (!visible) return null;

  const panel = (
    <View
      style={{
        position: "absolute",
        bottom: overlayBottom ?? "100%",
        // Absolute children measure from the parent's border box, so the
        // composer's own horizontal padding has to be repeated here for the
        // panel to line up with the glass bar under it.
        left: spacing.ms,
        right: spacing.ms,
        marginBottom: overlayBottom === null ? spacing.xs : 0,
        maxHeight,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: colors.secondarySystemBackground,
        boxShadow: shadows.card,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: spacing.md,
          paddingRight: spacing.sm,
          paddingTop: spacing.sm,
        }}
      >
        <ThemedText variant="caption" style={{ flex: 1, fontWeight: "600" }}>
          {bucket === "plugins" ? "Plugins" : filter ? `Matching “${filter}”` : "Add context"}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => ({ padding: spacing.xs, opacity: pressed ? 0.6 : 1 })}
        >
          <SFSymbol name="xmark" size={12} tint={colors.tertiaryLabel} />
        </Pressable>
      </View>

      {sections.length === 0 ? (
        <ThemedText
          variant="footnote"
          style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.ml, textAlign: "center" }}
        >
          {empty}
        </ThemedText>
      ) : (
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingBottom: spacing.sm }}>
          {sections.map((section) => (
            <View key={section.title}>
              <ThemedText
                variant="caption2"
                style={{
                  paddingHorizontal: spacing.md,
                  paddingTop: spacing.sm,
                  paddingBottom: spacing.xxs,
                  fontWeight: "600",
                }}
              >
                {section.title}
              </ThemedText>
              {section.rows.map((row) => (
                <RowButton
                  key={row.kind === "skill" ? `s-${row.skill.name}` : `c-${row.command.name}`}
                  row={row}
                  onPress={() => onSelect(row)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );

  if (overlayBottom === null) return panel;

  const overlay = (
    <View
      accessibilityViewIsModal
      style={StyleSheet.absoluteFill}
    >
      <Pressable
        accessibilityLabel="Close plugins"
        accessibilityRole="button"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />
      {panel}
    </View>
  );

  if (Platform.OS === "ios") {
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal>
        {overlay}
      </FullWindowOverlay>
    );
  }

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      {overlay}
    </Modal>
  );
}

function RowButton({ row, onPress }: { row: PickerRow; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.ms,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm + 2,
        backgroundColor: pressed ? colors.fill : "transparent",
      })}
    >
      {row.kind === "skill" ? <SkillRowBody skill={row.skill} /> : <CommandRowBody command={row.command} />}
    </Pressable>
  );
}

/**
 * Artwork a phone can load itself. The Mac inlines a plugin's icons as data
 * URLs (or leaves them remote); a plain skill's are absolute paths on its disk.
 */
const LOADABLE_ICON = /^(data:image\/|https:)/i;

const SKILL_ICON_SIZE = 26;

/**
 * The desktop's row icon: the plugin's artwork over a soft wash of its brand
 * color, the large one first — it is usually a PNG, where the small one is
 * often an SVG iOS's decoder can refuse. Whatever fails to load falls through
 * to the next, and last to a sparkle.
 */
function SkillIcon({ skill }: { skill: SkillRow }) {
  const [failed, setFailed] = useState<string[]>([]);
  const softTint = useSoftTint();
  const wash = skill.brandColor ? softTint(skill.brandColor) : colors.fill;
  const source = [skill.iconLarge, skill.iconSmall].find(
    (icon): icon is string => !!icon && LOADABLE_ICON.test(icon) && !failed.includes(icon),
  );

  return (
    <View
      style={{
        width: SKILL_ICON_SIZE,
        height: SKILL_ICON_SIZE,
        borderRadius: 7,
        borderCurve: "continuous",
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: wash,
      }}
    >
      {source ? (
        <Image
          source={{ uri: source }}
          contentFit="contain"
          onError={() => setFailed((previous) => [...previous, source])}
          style={{ width: SKILL_ICON_SIZE, height: SKILL_ICON_SIZE }}
        />
      ) : (
        <SFSymbol name="sparkles" size={14} tint={colors.secondaryLabel} />
      )}
    </View>
  );
}

function SkillRowBody({ skill }: { skill: SkillRow }) {
  const badge = scopeLabel(skill.scope);
  const description = skill.shortDescription ?? skill.description;

  return (
    <>
      <SkillIcon skill={skill} />

      <View style={{ flex: 1, gap: spacing.xxs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <ThemedText variant="callout" numberOfLines={1} style={{ flexShrink: 1, fontWeight: "600" }}>
            {skill.displayName || skill.name}
          </ThemedText>
          {skill.argumentHint ? (
            <ThemedText variant="caption2" numberOfLines={1}>
              {skill.argumentHint}
            </ThemedText>
          ) : null}
          {badge ? (
            <View
              style={{
                marginLeft: "auto",
                paddingHorizontal: spacing.sm,
                paddingVertical: 1,
                borderRadius: radius.full,
                backgroundColor: colors.fill,
              }}
            >
              {/* caption2's tertiary grey vanished into the fill; the badge reads in secondary. */}
              <ThemedText variant="caption2" style={{ color: colors.secondaryLabel, fontWeight: "600" }}>
                {badge}
              </ThemedText>
            </View>
          ) : null}
        </View>
        {description ? (
          <ThemedText variant="footnote" numberOfLines={2}>
            {description}
          </ThemedText>
        ) : null}
      </View>
    </>
  );
}

function CommandRowBody({ command }: { command: CommandRow }) {
  return (
    <View style={{ flex: 1, gap: spacing.xxs }}>
      <ThemedText variant="callout" numberOfLines={1} style={{ fontWeight: "600" }}>
        /{command.name}
      </ThemedText>
      {command.description ? (
        <ThemedText variant="footnote" numberOfLines={2}>
          {command.description}
        </ThemedText>
      ) : null}
    </View>
  );
}
