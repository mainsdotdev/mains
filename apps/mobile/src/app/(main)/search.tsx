import { and, asc, desc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
// Not Reanimated's: its own hook is deprecated (iOS bugs) and points here.
import { useAnimatedKeyboard } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/backend/backend-session";
import { GlassSurface } from "@/components/glass-surface";
import { SFSymbol } from "@/components/sf-symbol";
import { ThemedText } from "@/components/themed-text";
import { WorkspaceRow } from "@/components/workspace-row";
import { db } from "@/db/client";
import { collections, projects, runs, workspaces, type RunRow as RunRecord } from "@/db/schema";
import { isModeId } from "@mains/contracts/modes";
import { modeLabel } from "@mains/contracts/runs";
import { relativeTime, runStatusLabel } from "@/lib/format";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { colors, radius, spacing, type } from "@/theme";

/** The bar's controls share one height with the workspace screen's. */
const BAR_HEIGHT = 52;
/** Chats shown for a query; the rest are one more letter away. */
const CHAT_LIMIT = 50;

/**
 * Search, in the shape of the Claude app's: the field sits at the bottom
 * beside the keys, the results stand above it, and an empty field shows only
 * what can be found. Everything on the Mac is searched at once — chats by
 * title or by their project's name, workspaces by name or branch — whatever
 * space is selected, which is the point: the sidebar's own filter only ever
 * saw one space's things, and half a screen of them under the keyboard.
 */
export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const runList = useLiveQuery(
    db
      .select()
      .from(runs)
      .where(and(eq(runs.backendId, backendId), eq(runs.isArchived, false)))
      .orderBy(desc(runs.updatedAt)),
    [backendId],
  );
  const workspaceList = useLiveQuery(
    db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.backendId, backendId), eq(workspaces.isArchived, false)))
      .orderBy(desc(workspaces.updatedAt)),
    [backendId],
  );
  const projectList = useLiveQuery(
    db.select().from(projects).where(eq(projects.backendId, backendId)),
    [backendId],
  );
  const collectionList = useLiveQuery(
    db
      .select()
      .from(collections)
      .where(and(eq(collections.backendId, backendId), eq(collections.isArchived, false)))
      .orderBy(asc(collections.name)),
    [backendId],
  );

  const projectIcons = useMemo(
    () => new Map(projectList.data.map((p) => [p.id, p.icon])),
    [projectList.data],
  );
  const workspaceNames = useMemo(
    () => new Map(workspaceList.data.map((w) => [w.id, w.name])),
    [workspaceList.data],
  );
  const collectionNames = useMemo(
    () => new Map(collectionList.data.map((c) => [c.id, c.name])),
    [collectionList.data],
  );

  const chats = useMemo(() => {
    if (!needle) return [];
    return runList.data
      .filter(
        (run) =>
          (run.title ?? "").toLowerCase().includes(needle) ||
          (collectionNames.get(run.collectionId ?? "") ?? "").toLowerCase().includes(needle),
      )
      .slice(0, CHAT_LIMIT);
  }, [runList.data, collectionNames, needle]);
  const found = useMemo(() => {
    if (!needle) return [];
    return workspaceList.data.filter(
      (w) => w.name.toLowerCase().includes(needle) || (w.branch ?? "").toLowerCase().includes(needle),
    );
  }, [workspaceList.data, needle]);

  /** Where a chat lives: its workspace or project, and the mode it ran in. */
  const placeOf = (run: RunRecord): string => {
    const home = run.workspaceId
      ? workspaceNames.get(run.workspaceId)
      : run.collectionId
        ? collectionNames.get(run.collectionId)
        : undefined;
    const mode = isModeId(run.mode) ? modeLabel(run.mode) : null;
    return [home, mode].filter(Boolean).join(" · ");
  };

  // Leave first, then go: the result opens under where the search was, not
  // on top of it, so coming back from the chat lands on the sidebar's screen.
  const open = (href: Href) => {
    router.back();
    router.push(href);
  };

  // The bar rides the keyboard, as every bottom bar in the app does.
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.value - insets.bottom) }],
  }));
  const keyboardInset = useKeyboardInset();
  const barRoom = insets.bottom + spacing.sm + BAR_HEIGHT + spacing.md;

  const searched = needle.length > 0;
  const nothing = searched && chats.length === 0 && found.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      {searched && !nothing ? (
        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingTop: insets.top + spacing.md,
            paddingHorizontal: spacing.sm,
            paddingBottom: barRoom + keyboardInset,
          }}
        >
          {chats.length > 0 && (
            <>
              <SectionHeader title="Chats" />
              {chats.map((run) => (
                <ChatHit key={run.id} run={run} place={placeOf(run)} onPress={() => open(`/run/${run.id}` as Href)} />
              ))}
            </>
          )}
          {found.length > 0 && (
            <>
              <SectionHeader title="Workspaces" />
              {found.map((workspace) => (
                <WorkspaceRow
                  key={workspace.id}
                  workspace={workspace}
                  projectIcon={projectIcons.get(workspace.projectId ?? "") ?? null}
                  onPress={() => open(`/workspace/${workspace.id}` as Href)}
                />
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        // Centered in what the keyboard leaves, as the reference does.
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.md,
            paddingTop: insets.top,
            paddingBottom: barRoom + keyboardInset,
            paddingHorizontal: spacing.xl,
          }}
        >
          <SFSymbol name="magnifyingglass" size={36} tint={colors.label} />
          <ThemedText variant="subhead" style={{ textAlign: "center" }}>
            {!session.backend
              ? "Pair a Mac to search its chats and workspaces."
              : nothing
                ? `Nothing matches “${query.trim()}”.`
                : "Search chats and workspaces"}
          </ThemedText>
        </View>
      )}

      {/* Bottom bar: the field on the left, close on the right */}
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
          <SFSymbol name="magnifyingglass" size={18} tint={colors.secondaryLabel} />
          <TextInput
            accessibilityLabel="Search"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.secondaryLabel as string}
            returnKeyType="search"
            style={[type.body, { flex: 1, height: BAR_HEIGHT, color: colors.label }]}
            value={query}
          />
        </GlassSurface>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()}>
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
      </Animated.View>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <ThemedText
      variant="body"
      style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.xs, fontWeight: "600" }}
    >
      {title}
    </ThemedText>
  );
}

/** A chat among results: title, where it lives, and when — or its live status. */
function ChatHit({ run, place, onPress }: { run: RunRecord; place: string; onPress: () => void }) {
  const live = run.status === "running" || run.status === "queued";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.ms,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: pressed ? colors.fill : "transparent",
      })}
    >
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <ThemedText variant="body" numberOfLines={1} style={{ fontWeight: "400" }}>
          {run.title?.trim() || "Untitled run"}
        </ThemedText>
        {place ? (
          <ThemedText variant="footnote" numberOfLines={1} style={{ color: colors.secondaryLabel }}>
            {place}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
        {live ? runStatusLabel(run.status) : relativeTime(run.updatedAt)}
      </ThemedText>
    </Pressable>
  );
}
