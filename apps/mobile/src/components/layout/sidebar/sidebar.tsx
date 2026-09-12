import { and, asc, desc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { backendSession, useSession } from "@/backend/backend-session";
import { setSpaceTarget } from "@/backend/sync";
import { db } from "@/db/client";
import {
  collections,
  projects,
  runs,
  spaceTargets,
  spaces,
  workspaces,
  type CollectionRow,
  type RunRow as RunRecord,
  type WorkspaceRow as WorkspaceRecord,
} from "@/db/schema";
import { goHome } from "@/features/runs";
import { colors, radius, spacing } from "@/theme";
import {
  ProjectIcon,
  RoundGlassButton,
  SFSymbol,
  ThemedText,
  useProjectNameColor,
} from "@/components/ui";
import { SpaceGlyph } from "@/features/spaces";
import { WorkspaceRow } from "@/features/workspaces";

import { RunRow } from "./run-row";

/** How many rows the flat Recents section shows (the desktop's `RECENTS_LIMIT`). */
const RECENTS_LIMIT = 20;

/**
 * The drawer, in the shape of the ChatGPT / Claude sidebars: an opaque panel
 * with a title and a search button, a short list of destinations, then what
 * the desktop sidebar shows for the selected space — a Code space lists its
 * workspaces; a Work or Chat space lists that provider's chats, the ones
 * filed under a project grouped beneath it and the rest under Recents. The
 * space switcher is pinned to the bottom next to Settings.
 */
export function Sidebar({ navigation }: { navigation: { closeDrawer(): void } }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const spaceId = session.selectedSpaceId ?? "";
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const runList = useLiveQuery(
    db
      .select()
      .from(runs)
      .where(and(eq(runs.backendId, backendId), eq(runs.isArchived, false)))
      .orderBy(desc(runs.updatedAt))
      .limit(200),
    [backendId],
  );
  const workspaceList = useLiveQuery(
    db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.backendId, backendId), eq(workspaces.isArchived, false))),
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
  const spaceList = useLiveQuery(
    db
      .select()
      .from(spaces)
      .where(and(eq(spaces.backendId, backendId), eq(spaces.isArchived, false)))
      .orderBy(asc(spaces.sortOrder), asc(spaces.name)),
    [backendId],
  );
  const targetQuery = useLiveQuery(
    db
      .select()
      .from(spaceTargets)
      .where(and(eq(spaceTargets.backendId, backendId), eq(spaceTargets.spaceId, spaceId)))
      .limit(1),
    [backendId, spaceId],
  );

  const space = spaceList.data.find((s) => s.id === spaceId);
  const target = targetQuery.data[0];
  const isCode = space?.mode === "developer";
  const projectIcons = useMemo(
    () => new Map(projectList.data.map((p) => [p.id, p.icon])),
    [projectList.data],
  );
  const workspaceNames = useMemo(
    () => new Map(workspaceList.data.map((w) => [w.id, w.name])),
    [workspaceList.data],
  );

  const items = useMemo<SidebarItem[]>(() => {
    const out: SidebarItem[] = [];
    if (!session.backend) {
      out.push({ kind: "empty", key: "unpaired", text: "Pair a Mac to see its work here." });
      return out;
    }
    if (isCode) {
      const list = [...workspaceList.data].sort(
        (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
      );
      out.push({ kind: "header", key: "h-workspaces", title: "Workspaces" });
      if (list.length === 0) {
        out.push({ kind: "empty", key: "e-workspaces", text: "No workspaces yet." });
      }
      for (const workspace of list) out.push({ kind: "workspace", key: workspace.id, workspace });
      return out;
    }
    // Chats: this space's provider and mode, like the desktop's recent list.
    const chats = runList.data.filter(
      (run) => !space || (run.providerId === space.providerId && run.mode === space.mode),
    );
    const byCollection = new Map<string, RunRecord[]>();
    for (const run of chats) {
      if (!run.collectionId) continue;
      const bucket = byCollection.get(run.collectionId);
      if (bucket) bucket.push(run);
      else byCollection.set(run.collectionId, [run]);
    }
    const groups = collectionList.data;
    if (groups.length > 0) {
      out.push({ kind: "header", key: "h-projects", title: "Projects" });
      for (const collection of groups) {
        const inside = byCollection.get(collection.id) ?? [];
        const open = !collapsed.has(collection.id);
        out.push({ kind: "group", key: `g-${collection.id}`, collection, count: inside.length, open });
        if (!open) continue;
        if (inside.length === 0) {
          out.push({ kind: "empty", key: `e-${collection.id}`, text: "No chats yet.", nested: true });
        }
        for (const run of inside) out.push({ kind: "run", key: `${collection.id}/${run.id}`, run, nested: true });
      }
    }
    const recents = chats.filter((run) => !run.collectionId).slice(0, RECENTS_LIMIT);
    out.push({ kind: "header", key: "h-recents", title: "Recents" });
    if (recents.length === 0) {
      out.push({ kind: "empty", key: "e-recents", text: "No chats yet." });
    }
    for (const run of recents) out.push({ kind: "run", key: run.id, run });
    return out;
  }, [session.backend, isCode, space, workspaceList.data, runList.data, collectionList.data, collapsed]);

  const go = (href: Href) => {
    navigation.closeDrawer();
    router.push(href);
  };

  const openWorkspace = (workspace: WorkspaceRecord) => {
    // Like the desktop, picking a workspace also makes it where new runs go.
    if (space) {
      setSpaceTarget(backendId, space.id, {
        workspaceId: workspace.id,
        collectionId: target?.collectionId ?? null,
      });
    }
    go(`/workspace/${workspace.id}` as Href);
  };

  const toggleGroup = (collectionId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  };

  return (
    <View
      style={{
        flex: 1,
        // Same ground as the scene; the card sets itself apart by dimming.
        backgroundColor: colors.systemBackground,
        paddingTop: insets.top + spacing.sm,
        paddingBottom: insets.bottom + spacing.sm,
      }}
    >
      {/* Title + search */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xxs,
        }}
      >
        <ThemedText variant="title2">Mains</ThemedText>
        {/* Search is its own screen: everything on the Mac, whatever the space. */}
        <RoundGlassButton size={44} icon="magnifyingglass" label="Search" onPress={() => go("/search" as Href)} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: spacing.md }}
        renderItem={({ item }) => {
          switch (item.kind) {
            case "header":
              return (
                <ThemedText
                  variant="body"
                  style={{ paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xs, fontWeight:600 }}
                >
                  {item.title}
                </ThemedText>
              );
            case "empty":
              return (
                <ThemedText
                  variant="subhead"
                  style={{ paddingHorizontal: item.nested ? spacing.xl : spacing.md, paddingVertical: spacing.xs }}
                >
                  {item.text}
                </ThemedText>
              );
            case "group":
              return (
                <GroupHeader
                  collection={item.collection}
                  count={item.count}
                  open={item.open}
                  onPress={() => toggleGroup(item.collection.id)}
                />
              );
            case "workspace":
              return (
                // A little air, so the selected row and a pressed one below it
                // read as two cards rather than one filled block.
                <View style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs }}>
                  <WorkspaceRow
                    workspace={item.workspace}
                    projectIcon={projectIcons.get(item.workspace.projectId ?? "") ?? null}
                    selected={target?.workspaceId === item.workspace.id}
                    onPress={() => openWorkspace(item.workspace)}
                  />
                </View>
              );
            case "run":
              return (
                <View style={{ paddingLeft: item.nested ? spacing.lg : spacing.sm, paddingRight: spacing.sm }}>
                  <RunRow
                    run={item.run}
                    grouped={false}
                    workspaceName={isCode ? workspaceNames.get(item.run.workspaceId ?? "") : undefined}
                    onNavigate={() => navigation.closeDrawer()}
                  />
                </View>
              );
          }
        }}
      />

      {/* Space switcher + settings — the space is where a new run goes. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, alignItems: "center" }}
          style={{ flex: 1 }}
        >
          {spaceList.data.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${item.name} space`}
              accessibilityState={{ selected: item.id === spaceId }}
              onPress={() => {
                backendSession.selectSpace(item.id);
                navigation.closeDrawer();
                goHome();
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <SpaceGlyph space={item} size={44} selected={item.id === spaceId} />
            </Pressable>
          ))}
        </ScrollView>
        <RoundGlassButton size={44} icon="gearshape" label="Settings" onPress={() => go("/settings" as Href)} />
      </View>
    </View>
  );
}

type SidebarItem =
  | { kind: "header"; key: string; title: string }
  | { kind: "empty"; key: string; text: string; nested?: boolean }
  | { kind: "group"; key: string; collection: CollectionRow; count: number; open: boolean }
  | { kind: "workspace"; key: string; workspace: WorkspaceRecord }
  | { kind: "run"; key: string; run: RunRecord; nested?: boolean };

/** A project (collection) in the chat sidebar: icon, name, chat count, disclosure. */
function GroupHeader({
  collection,
  count,
  open,
  onPress,
}: {
  collection: CollectionRow;
  count: number;
  open: boolean;
  onPress: () => void;
}) {
  const nameColor = useProjectNameColor(collection.icon);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        marginHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.sm,
        borderCurve: "continuous",
        backgroundColor: pressed ? colors.fill : "transparent",
      })}
    >
      <View style={{ width: 22, alignItems: "center" }}>
        <ProjectIcon icon={collection.icon} size={16} color={colors.secondaryLabel} />
      </View>
      <ThemedText
        variant="body"
        numberOfLines={1}
        style={{ flex: 1, fontWeight: "600", color: nameColor }}
      >
        {collection.name}
      </ThemedText>
      {count > 0 && (
        <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {count}
        </ThemedText>
      )}
      <SFSymbol name={open ? "chevron.down" : "chevron.right"} size={12} tint={colors.tertiaryLabel} />
    </Pressable>
  );
}
