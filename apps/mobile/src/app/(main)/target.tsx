import { and, asc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";

import { useSession } from "@/backend/backend-session";
import { setSpaceTarget } from "@/backend/sync";
import { ProjectIcon, SFSymbol, ThemedText } from "@/components/ui";
import { db } from "@/db/client";
import { collections, spaceTargets, spaces, workspaces } from "@/db/schema";
import { colors, radius, shadows, spacing, useBrandColors } from "@/theme";

/**
 * The run target sheet: a workspace for a Code space, an optional project
 * (collection) for Work/Chat. Remembered per space on this phone.
 */
export default function TargetSheet() {
  const router = useRouter();
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const spaceId = session.selectedSpaceId ?? "";

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
  const workspaceQuery = useLiveQuery(
    db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.backendId, backendId), eq(workspaces.isArchived, false)))
      .orderBy(asc(workspaces.name)),
    [backendId],
  );
  const collectionQuery = useLiveQuery(
    db
      .select()
      .from(collections)
      .where(and(eq(collections.backendId, backendId), eq(collections.isArchived, false)))
      .orderBy(asc(collections.name)),
    [backendId],
  );

  const space = spaceQuery.data[0];
  const target = targetQuery.data[0];
  const isCode = space?.mode === "developer";

  const choose = (patch: { workspaceId?: string | null; collectionId?: string | null }) => {
    setSpaceTarget(backendId, spaceId, {
      workspaceId: patch.workspaceId !== undefined ? patch.workspaceId : (target?.workspaceId ?? null),
      collectionId: patch.collectionId !== undefined ? patch.collectionId : (target?.collectionId ?? null),
    });
    router.back();
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      <View style={{ gap: spacing.xxs }}>
        <ThemedText variant="title2">{isCode ? "Workspace" : "Project"}</ThemedText>
        <ThemedText variant="subhead">
          {isCode
            ? "Code runs work inside a workspace on your Mac."
            : "Optional — file this run under a project, or leave it standalone."}
        </ThemedText>
      </View>

      <View
        style={{
          borderRadius: radius.lg,
          borderCurve: "continuous",
          backgroundColor: colors.groupedCell,
          boxShadow: shadows.card,
          overflow: "hidden",
        }}
      >
        {isCode ? (
          workspaceQuery.data.length > 0 ? (
            workspaceQuery.data.map((workspace, index) => (
              <Row
                key={workspace.id}
                first={index === 0}
                label={workspace.name}
                // Worktrees of one repo share a name; the branch tells them apart.
                detail={workspace.branch}
                selected={target?.workspaceId === workspace.id}
                onPress={() => choose({ workspaceId: workspace.id })}
              />
            ))
          ) : (
            <ThemedText variant="subhead" style={{ padding: spacing.md }}>
              No workspaces on this Mac yet.
            </ThemedText>
          )
        ) : (
          <>
            <Row
              first
              leading={<SFSymbol name="tray" size={18} tint={colors.secondaryLabel} />}
              label="No project"
              selected={!target?.collectionId}
              onPress={() => choose({ collectionId: null })}
            />
            {collectionQuery.data.map((collection) => (
              <Row
                key={collection.id}
                first={false}
                leading={<ProjectIcon icon={collection.icon} size={18} color={colors.secondaryLabel} />}
                label={collection.name}
                selected={target?.collectionId === collection.id}
                onPress={() => choose({ collectionId: collection.id })}
              />
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Row({
  label,
  detail = null,
  leading,
  selected,
  onPress,
  first,
}: {
  label: string;
  /** A second line under the name — a workspace's branch. */
  detail?: string | null;
  /** The project's icon; workspace rows have none. */
  leading?: React.ReactNode;
  selected: boolean;
  onPress: () => void;
  first: boolean;
}) {
  const brand = useBrandColors();
  return (
    <View>
      {!first && <View style={{ height: 1, marginLeft: spacing.md, backgroundColor: colors.separator }} />}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.ms,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.ms + 2,
          backgroundColor: pressed ? colors.fill : "transparent",
        })}
      >
        {leading && (
          <View style={{ width: 22, alignItems: "center" }}>{leading}</View>
        )}
        <View style={{ flex: 1, gap: 1 }}>
          <ThemedText variant="body" numberOfLines={1}>
            {label}
          </ThemedText>
          {detail ? (
            <ThemedText variant="footnote" numberOfLines={1} style={{ color: colors.secondaryLabel }}>
              {detail}
            </ThemedText>
          ) : null}
        </View>
        {selected && <SFSymbol name="checkmark" size={16} tint={brand.accent} />}
      </Pressable>
    </View>
  );
}
