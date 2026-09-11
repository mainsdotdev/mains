import { and, desc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
// Not Reanimated's: its own hook is deprecated (iOS bugs) and points here.
import { useAnimatedKeyboard } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/backend/backend-session";
import { setSpaceTarget } from "@/backend/sync";
import { GlassSurface } from "@/components/glass-surface";
import { SFSymbol } from "@/components/sf-symbol";
import { ThemedText } from "@/components/themed-text";
import { db } from "@/db/client";
import { runs, spaceTargets, spaces, workspaces, type RunRow as RunRecord } from "@/db/schema";
import { relativeTime, runStatusLabel } from "@/lib/format";
import { goHome } from "@/lib/home-run";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { colors, radius, spacing, type, useBrandColors } from "@/theme";

/** The bar's controls share one height, like the Codex app's search pill and compose button. */
const BAR_HEIGHT = 52;

/**
 * A workspace, as the desktop's workspace page: its name and branch in the
 * header, its runs, newest first, as a plain list of titles. The bottom bar
 * holds a search pill on the left — focusing it lifts the bar above the
 * keyboard and filters the list as you type — and, on the right, the button
 * that starts a new run here.
 */
export default function WorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workspaceId = typeof id === "string" ? id : "";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const brand = useBrandColors();
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const spaceId = session.selectedSpaceId ?? "";

  const workspaceQuery = useLiveQuery(
    db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.backendId, backendId), eq(workspaces.id, workspaceId)))
      .limit(1),
    [backendId, workspaceId],
  );
  const runQuery = useLiveQuery(
    db
      .select()
      .from(runs)
      .where(and(eq(runs.backendId, backendId), eq(runs.workspaceId, workspaceId), eq(runs.isArchived, false)))
      .orderBy(desc(runs.updatedAt)),
    [backendId, workspaceId],
  );
  const spaceQuery = useLiveQuery(
    db.select().from(spaces).where(and(eq(spaces.backendId, backendId), eq(spaces.id, spaceId))).limit(1),
    [backendId, spaceId],
  );
  const targetQuery = useLiveQuery(
    db
      .select()
      .from(spaceTargets)
      .where(and(eq(spaceTargets.backendId, backendId), eq(spaceTargets.spaceId, spaceId)))
      .limit(1),
    [backendId, spaceId],
  );

  const workspace = workspaceQuery.data[0];
  const space = spaceQuery.data[0];
  const target = targetQuery.data[0];

  // The bar rides the keyboard: an absolutely positioned child sees none of
  // KeyboardAvoidingView's padding, so it follows the keyboard's height itself.
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.value - insets.bottom) }],
  }));

  // Room under the list while the search keyboard is up, so the last rows can
  // be scrolled clear of it — as padding; see the hook for why not the prop.
  const keyboardInset = useKeyboardInset();

  const searchRef = useRef<TextInput>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Scoped to the space you are in, the way the sidebar's chat list and the
  // desktop's own workspace page are (`loadWorkspaceRuns` passes providerId and
  // mode). Provider and mode, not space id: two spaces can drive the same agent
  // in the same mode, and a run belongs under either of them.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return runQuery.data.filter(
      (run) =>
        (!space || (run.providerId === space.providerId && run.mode === space.mode)) &&
        (!needle || runTitle(run).toLowerCase().includes(needle)),
    );
  }, [runQuery.data, query, space]);

  const closeSearch = () => {
    setQuery("");
    setSearching(false);
    searchRef.current?.blur();
  };

  // "New run here": aim the selected space at this workspace and go to the
  // composer, the way picking a workspace on the desktop makes it current.
  const startRunHere = () => {
    if (space) {
      setSpaceTarget(backendId, space.id, { workspaceId, collectionId: target?.collectionId ?? null });
    }
    goHome();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <HeaderTitle name={workspace?.name ?? "Workspace"} branch={workspace?.branch ?? null} />
          ),
        }}
      />
      <FlatList
        data={visible}
        keyExtractor={(run) => run.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
          paddingBottom: insets.bottom + BAR_HEIGHT + spacing.xl + keyboardInset,
        }}
        ListEmptyComponent={
          <ThemedText variant="subhead" style={{ paddingVertical: spacing.md, fontWeight: 600 }}>
            {!session.backend
              ? "Pair a Mac to see its runs here."
              : query
                ? "No runs match."
                : "No runs in this workspace yet."}
          </ThemedText>
        }
        renderItem={({ item }) => <TitleRow run={item} onPress={() => router.push(`/run/${item.id}` as Href)} />}
      />

      {/* Bottom bar: search on the left, new run on the right */}
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.ms,
            paddingHorizontal: spacing.md,
            paddingBottom: insets.bottom + spacing.sm,
          },
          lift,
        ]}
      >
        <GlassSurface
          interactive
          style={{
            flex: 1,
            height: BAR_HEIGHT,
            borderRadius: radius.full,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
          }}
        >
          <SFSymbol name="magnifyingglass" size={18} tint={colors.onTint} />
          <TextInput
            ref={searchRef}
            accessibilityLabel="Search runs"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            onFocus={() => setSearching(true)}
            onBlur={() => {
              if (!query) setSearching(false);
            }}
            placeholder="Search runs"
            placeholderTextColor={colors.secondaryLabel as string}
            returnKeyType="search"
            style={[type.body, { flex: 1, height: BAR_HEIGHT, color: colors.label }]}
            value={query}
          />
        </GlassSurface>

        {searching ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Close search" onPress={closeSearch}>
            {({ pressed }) => (
              // Opacity goes on a wrapper: a translucent glass view stops rendering as glass.
              <View style={{ opacity: pressed ? 0.7 : 1 }}>
                <GlassSurface
                  interactive
                  style={{
                    width: BAR_HEIGHT,
                    height: BAR_HEIGHT,
                    borderRadius: BAR_HEIGHT / 2,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <SFSymbol name="xmark" size={20} tint={colors.label} />
                </GlassSurface>
              </View>
            )}
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`New run in ${workspace?.name ?? "this workspace"}`}
            disabled={!space}
            onPress={startRunHere}
            style={({ pressed }) => ({
              width: BAR_HEIGHT,
              height: BAR_HEIGHT,
              borderRadius: BAR_HEIGHT / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: brand.accent,
              opacity: pressed ? 0.7 : space ? 1 : 0.5,
            })}
          >
            <SFSymbol name="square.and.pencil" size={22} tint={brand.accentContrast} />
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

/** The navigation title: the workspace's name over its branch. */
function HeaderTitle({ name, branch }: { name: string; branch: string | null }) {
  return (
    <View style={{ alignItems: "center" }}>
      <ThemedText variant="headline" numberOfLines={1}>
        {name}
      </ThemedText>
      {branch ? (
        <ThemedText variant="caption2" numberOfLines={1} style={{ color: colors.secondaryLabel }}>
          {branch}
        </ThemedText>
      ) : null}
    </View>
  );
}

function runTitle(run: RunRecord): string {
  return run.title?.trim() || "Untitled run";
}

/** A run as a bare title, its age (or live status) on the right — the Codex list look. */
function TitleRow({ run, onPress }: { run: RunRecord; onPress: () => void }) {
  const live = run.status === "running" || run.status === "queued";
  const brand = useBrandColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xs,
        borderRadius: radius.sm,
        borderCurve: "continuous",
        backgroundColor: pressed ? colors.fill : "transparent",
      })}
    >
      <ThemedText variant="body" numberOfLines={1} style={{ flex: 1, fontWeight:500 }}>
        {runTitle(run)}
      </ThemedText>
      <ThemedText
        variant="caption"
        style={{ fontVariant: ["tabular-nums"], color: live ? brand.accent : colors.tertiaryLabel }}
      >
        {live ? runStatusLabel(run.status) : relativeTime(run.updatedAt)}
      </ThemedText>
    </Pressable>
  );
}
