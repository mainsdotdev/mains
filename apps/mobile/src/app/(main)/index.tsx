import { MenuView } from "@expo/ui/community/menu";
import { and, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useNavigation, useRouter, type Href } from "expo-router";
import { DrawerActions } from "expo-router/react-navigation";
import { useState, type ComponentProps } from "react";
import { Keyboard, Pressable, View } from "react-native";
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { backendSession, useSession } from "@/backend/backend-session";
import { DEMO_SUGGESTED_PROMPT } from "@/backend/demo/demo-scenarios";
import { startDemo } from "@/backend/demo/start";
import { DEMO_BACKEND_ID } from "@/backend/demo/transport";
import { useAiDataConsent } from "@/components/ai-data-consent-provider";
import { Button } from "@/components/button";
import {
  ComposerBar,
  composerBottomPadding,
  type ComposerSendOrigin,
} from "@/components/composer-bar";
import { GlassSurface } from "@/components/glass-surface";
import { attachedSkills, composeGoal } from "@/lib/context-picker";
import {
  serializeComposerAttachments,
  type ComposerAttachment,
} from "@/lib/composer-attachments";
import type { PromptSkill } from "@/lib/prompt-chips";
import { ModeMenu } from "@/components/mode-menu";
import { ProjectIcon } from "@/components/project-icon";
import { RoundGlassButton } from "@/components/round-glass-button";
import { RunView } from "@/components/run-view";
import { SFSymbol } from "@/components/sf-symbol";
import { SidebarIcon } from "@/components/sidebar-icon";
import { ConnectionBadge } from "@/components/status";
import { ThemedText } from "@/components/themed-text";
import { providerModes, type ModeId } from "@mains/contracts/runs";
import { homeRun, useHomeRun } from "@/lib/home-run";
import { useModelSelection } from "@/lib/use-model-selection";
import { useRunTitle } from "@/lib/use-run-title";
import { db } from "@/db/client";
import { collections, projects, providers, spaceTargets, spaces, workspaces } from "@/db/schema";
import { colors, radius, shadows, spacing, useProviderAccentPair } from "@/theme";

/** The round glass buttons' size, and the pills' height, along the top. */
const CONTROL_HEIGHT = 46;
/** Two 44-point targets plus the capsule's horizontal padding. */
const RUN_TOOLBAR_WIDTH = 44 * 2 + spacing.xs * 2;
/** The connection pill under them, shown while the Mac is out of reach. */
const PILL_HEIGHT = 30;

/**
 * Home, in the shape of a chat app's "new conversation": the mode segment on
 * top, an empty canvas, the run target above the composer, the composer at
 * the bottom. The target model is the desktop's: the space chosen in the
 * sidebar pins provider + mode; Code runs need a workspace, Work/Chat may
 * take a project.
 *
 * And, as in a chat app, a send does not leave the screen: the conversation
 * starts right here, and the top row becomes the run screen's — its title
 * where the mode segment was, its toolbar on the right — so a run looks the
 * same whether it began here or was opened from a list.
 */
export default function NewRunScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const { requestConsent } = useAiDataConsent();
  const backendId = session.backend?.backendId ?? "";
  const spaceId = session.selectedSpaceId ?? "";
  const connected = session.connection.kind === "connected";
  const isDemo = backendId === DEMO_BACKEND_ID;

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
    db.select().from(workspaces).where(eq(workspaces.backendId, backendId)),
    [backendId],
  );
  const collectionQuery = useLiveQuery(
    db.select().from(collections).where(eq(collections.backendId, backendId)),
    [backendId],
  );
  // A workspace wears its project's icon, as it does in the sidebar's rows.
  const projectQuery = useLiveQuery(
    db.select().from(projects).where(eq(projects.backendId, backendId)),
    [backendId],
  );
  const providerQuery = useLiveQuery(
    db.select().from(providers).where(eq(providers.backendId, backendId)),
    [backendId],
  );

  const space = spaceQuery.data[0];
  const target = targetQuery.data[0];
  const isCode = space?.mode === "developer";
  const workspace = workspaceQuery.data.find((w) => w.id === target?.workspaceId);
  const collection = collectionQuery.data.find((c) => c.id === target?.collectionId);
  const project = projectQuery.data.find((p) => p.id === workspace?.projectId);
  const providerEnabled = space
    ? providerQuery.data.some((p) => p.id === space.providerId && p.isEnabled)
    : true;
  const modes = space ? providerModes(space.providerId) : [];
  const modelSelection = useModelSelection(backendId, space?.providerId ?? "");

  const [draft, setDraft] = useState("");
  const [contextSkills, setContextSkills] = useState<PromptSkill[]>([]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [demoStarting, setDemoStarting] = useState(false);
  const [pendingMode, setPendingMode] = useState<ModeId | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // The run this screen is showing, once one has been started from it.
  const home = useHomeRun();
  const inRun = home.pending !== null || home.runId !== null;
  // A paired Mac that cannot be reached right now: said under the controls,
  // where a tap leads to the settings that explain and fix it.
  const offline = Boolean(session.backend) && !connected;
  const title = useRunTitle(home.runId ?? "");

  // Same rule as the run and workspace screens: move by the keyboard's height
  // less the safe-area inset the bar already sits above.
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.value - insets.bottom) }],
  }));

  // Two sheets behind the composer's two chips: the model (and its effort)
  // behind the model chip, how the agent may act behind the permission chip.
  const openModel = (providerId: string) =>
    router.push({ pathname: "/model", params: { providerId } } as Href);
  const openRunOptions = (providerId: string) =>
    router.push({ pathname: "/run-options", params: { providerId } } as Href);

  const openSidebar = () => {
    // The drawer only dismisses the keyboard for the swipe gesture; the
    // button path has to do it, or the composer stays focused under the panel.
    Keyboard.dismiss();
    navigation.dispatch(DrawerActions.openDrawer());
  };

  const changeMode = async (mode: ModeId) => {
    if (!space || mode === space.mode) return;
    setPendingMode(mode);
    setHint(null);
    const result = await backendSession.setSpaceMode(space.id, mode);
    setPendingMode(null);
    if (!result.success) setHint(result.error);
  };

  const tryDemo = async () => {
    if (demoStarting) return;
    setDemoStarting(true);
    setHint(null);
    try {
      await startDemo();
    } catch (caught) {
      setHint(caught instanceof Error ? caught.message : "Could not start Demo Mode");
    } finally {
      setDemoStarting(false);
    }
  };

  const send = async (origin: ComposerSendOrigin | null) => {
    // What was typed plus a token per attached skill — the chips never put one
    // in the input, but the transcript needs it to draw them back.
    const goal = composeGoal(draft, contextSkills);
    if ((!goal && attachments.length === 0) || !space || !connected || sending) return;
    if (isCode && !workspace) {
      setHint("Pick a workspace for this Code run first.");
      return;
    }
    const skills = attachedSkills(draft, contextSkills);
    const sentAttachments = attachments;
    setSending(true);
    setHint(null);
    try {
      const allowed = await requestConsent(backendId, space.providerId);
      if (!allowed) return;
      const serializedAttachments = await serializeComposerAttachments(sentAttachments);

      // The conversation starts here and now: the prompt goes up as a bubble
      // before the Mac has answered, and the transcript fills in under it once
      // it has. A refusal takes the bubble back down and leaves the draft as it
      // was, with the reason under it.
      homeRun.start({
        text: goal,
        sourceText: draft,
        skills,
        origin,
        attachments: sentAttachments,
      });
      const result = await backendSession.startRun({
        goal,
        workspaceId: workspace?.id ?? null,
        collectionId: collection?.id ?? null,
        attachments: serializedAttachments,
        contextSkills: skills,
        model: modelSelection.selected?.id ?? null,
      });
      if (!result.success) {
        homeRun.clear();
        setHint(result.error);
        return;
      }
      setDraft("");
      setContextSkills([]);
      setAttachments([]);
      homeRun.started(result.data.runId);
    } catch (caught) {
      homeRun.clear();
      setHint(caught instanceof Error ? caught.message : "Could not start the run");
    } finally {
      setSending(false);
    }
  };

  const targetLabel = isCode
    ? (workspace?.name ?? "Choose a workspace")
    : (collection?.name ?? "No project");

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      {/* Floating controls instead of a navigation bar */}
      <View
        style={{
          position: "absolute",
          top: insets.top + spacing.sm,
          left: spacing.md,
          right: spacing.md,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 1,
        }}
      >
        <RoundGlassButton
          icon={<SidebarIcon size={22} color={colors.label} />}
          label="Open sidebar"
          onPress={openSidebar}
        />
        {inRun ? (
          <>
            <ThemedText variant="headline" numberOfLines={1} style={{ flex: 1, marginHorizontal: spacing.md }}>
              {title ?? space?.name ?? "Run"}
            </ThemedText>
            <RunToolbar onNewRun={() => homeRun.clear()} />
          </>
        ) : (
          <>
            {space ? (
              <ModeMenu
                modes={modes}
                value={pendingMode ?? (space.mode as ModeId)}
                pending={pendingMode !== null}
                onChange={(mode) => void changeMode(mode)}
              />
            ) : (
              <View />
            )}
            {/* Balances the sidebar button, so the mode segment sits centered. */}
            <View style={{ width: CONTROL_HEIGHT }} />
          </>
        )}
      </View>

      {offline && session.backend ? (
        <View
          style={{
            position: "absolute",
            top: insets.top + spacing.sm + CONTROL_HEIGHT + spacing.sm,
            left: 0,
            right: 0,
            alignItems: "center",
            zIndex: 1,
          }}
        >
          <ConnectionPill name={session.backend.name} onPress={() => router.push("/settings" as Href)} />
        </View>
      ) : null}

      {inRun ? (
        <RunView
          runId={home.runId ?? ""}
          pending={home.pending}
          providerId={space?.providerId ?? null}
          topInset={insets.top}
          // Under the floating controls, with the same gap again beneath them —
          // and under the connection pill too, while there is one.
          topPadding={CONTROL_HEIGHT + spacing.sm + (offline ? PILL_HEIGHT + spacing.sm : 0)}
        />
      ) : (
        // The canvas stays empty on purpose.
        <View style={{ flex: 1 }} />
      )}

      {/* The composer rides the keyboard rather than being padded above it:
          KeyboardAvoidingView lifts by the *whole* keyboard height, on top of
          the home-indicator inset this block already carries, which left a
          band of background between the bar and the keys. */}
      {!inRun ? (
        <Animated.View style={[{ paddingBottom: composerBottomPadding(insets.bottom), gap: spacing.ms }, lift]}>
          {!session.backend && session.loaded && (
            <View
              style={{
                marginHorizontal: spacing.ms,
                padding: spacing.md,
                borderRadius: radius.lg,
                borderCurve: "continuous",
                backgroundColor: colors.groupedCell,
                boxShadow: shadows.card,
                gap: spacing.sm,
              }}
            >
              <ThemedText variant="headline">No Mac paired</ThemedText>
              <ThemedText variant="subhead">
                Open Mains on the desktop, turn on network access or Tailscale HTTPS, and scan its pairing code.
              </ThemedText>
              <Button title="Scan pairing code" onPress={() => router.push("/pair" as Href)} />
              <Button
                title="Try Demo Mode on this phone"
                variant="secondary"
                loading={demoStarting}
                onPress={() => void tryDemo()}
              />
            </View>
          )}

          {hint ? (
            <ThemedText
              variant="footnote"
              selectable
              style={{ textAlign: "center", paddingHorizontal: spacing.lg, color: colors.systemOrange }}
            >
              {hint}
            </ThemedText>
          ) : null}
          {isDemo && space && !draft.trim() ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Use suggested demo prompt: ${DEMO_SUGGESTED_PROMPT}`}
              onPress={() => {
                setDraft(DEMO_SUGGESTED_PROMPT);
                setHint(null);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginHorizontal: spacing.md,
                paddingHorizontal: spacing.ms,
                paddingVertical: spacing.sm,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: colors.fill,
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <SFSymbol name="sparkles" size={14} tint={colors.secondaryLabel} />
              <ThemedText variant="footnote" numberOfLines={2} style={{ flex: 1 }}>
                Suggested demo: {DEMO_SUGGESTED_PROMPT}
              </ThemedText>
              <SFSymbol name="arrow.up.left" size={12} tint={colors.tertiaryLabel} />
            </Pressable>
          ) : null}

          {/* Run target */}
          {space && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
              }}
            >
              <TargetChip
                icon={isCode ? (project?.icon ?? null) : (collection?.icon ?? null)}
                fallbackSymbol={isCode ? "folder" : "tray"}
                label={targetLabel}
                emphasized={isCode && !workspace}
                providerId={space.providerId}
                onPress={() => router.push("/target" as Href)}
              />
            </View>
          )}

          <ComposerBar
            reservedTop={insets.top + spacing.sm + CONTROL_HEIGHT + spacing.sm}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (hint) setHint(null);
            }}
            onSend={(origin) => void send(origin)}
            sending={sending}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            placeholder={space ? `Start a run in ${space.name}` : "Start a run"}
            disabled={!session.backend || !connected || !space || !providerEnabled}
            model={
              space && modelSelection.label
                ? {
                    label: modelSelection.label,
                    effort: modelSelection.effortLabel,
                    onPress: () => openModel(space.providerId),
                  }
                : null
            }
            permission={
              space && modelSelection.permissionLabel
                ? { label: modelSelection.permissionLabel, onPress: () => openRunOptions(space.providerId) }
                : null
            }
            providerId={space?.providerId}
            context={
              backendId && space
                ? {
                    backendId,
                    providerId: space.providerId,
                    workspacePath: workspace?.rootPath ?? null,
                    skills: contextSkills,
                    onSkillsChange: setContextSkills,
                  }
                : null
            }
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** The Mac's name and its state, as a pill that opens the settings behind it. */
function ConnectionPill({ name, onPress }: { name: string; onPress: () => void }) {
  const session = useSession();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}: unreachable. Open settings`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        height: PILL_HEIGHT,
        paddingLeft: spacing.ms,
        paddingRight: spacing.sm,
        borderRadius: radius.full,
        backgroundColor: colors.fill,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <ThemedText variant="footnote">{name}</ThemedText>
      <ConnectionBadge state={session.connection} />
      <SFSymbol name="chevron.right" size={10} tint={colors.tertiaryLabel} />
    </Pressable>
  );
}

/**
 * The run screen's toolbar, drawn by hand: "new run" beside a menu, in one
 * glass capsule — what its native `Stack.Toolbar` renders under a header.
 */
function RunToolbar({ onNewRun }: { onNewRun: () => void }) {
  return (
    <GlassSurface
      interactive
      style={{
        width: RUN_TOOLBAR_WIDTH,
        height: CONTROL_HEIGHT,
        borderRadius: radius.full,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.xs,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New run"
        onPress={onNewRun}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <ToolbarGlyph icon="square.and.pencil" />
      </Pressable>
      {/* The menu owns the tap: its trigger is a plain view, not a pressable. */}
      <MenuView
        actions={[{ id: "sync", title: "Sync now", image: "arrow.clockwise" }]}
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === "sync") void backendSession.refresh();
        }}
      >
        <ToolbarGlyph icon="ellipsis" />
      </MenuView>
    </GlassSurface>
  );
}

function ToolbarGlyph({ icon }: { icon: ComponentProps<typeof SFSymbol>["name"] }) {
  return (
    <View
      accessibilityLabel={icon === "ellipsis" ? "More" : undefined}
      style={{ width: 44, height: CONTROL_HEIGHT, alignItems: "center", justifyContent: "center" }}
    >
      <SFSymbol name={icon} size={20} tint={colors.label} />
    </View>
  );
}

function TargetChip({
  icon,
  fallbackSymbol,
  label,
  emphasized = false,
  providerId = null,
  onPress,
}: {
  /** The project's or collection's stored icon; null when it has none. */
  icon: string | null;
  /** SF Symbol drawn when there is no icon to show — what the target *is*. */
  fallbackSymbol: string;
  label: string;
  /** Draws attention to a target still to be chosen — in the provider's color. */
  emphasized?: boolean;
  /** The space's provider: whose accent the emphasized chip wears. */
  providerId?: string | null;
  onPress: () => void;
}) {
  const provider = useProviderAccentPair(providerId);
  const tint = emphasized ? provider.accent : colors.secondaryLabel;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs + 2,
        paddingLeft: spacing.ms,
        paddingRight: spacing.sm,
        height: 34,
        borderRadius: radius.full,
        backgroundColor: emphasized ? provider.soft : colors.fill,
        opacity: pressed ? 0.7 : 1,
        maxWidth: "70%",
      })}
    >
      {icon ? (
        <ProjectIcon icon={icon} size={14} color={tint} />
      ) : (
        <SFSymbol name={fallbackSymbol} size={14} tint={tint} />
      )}
      <ThemedText
        variant="footnote"
        numberOfLines={1}
        style={{ color: emphasized ? provider.accent : colors.label, fontWeight: "600" }}
      >
        {label}
      </ThemedText>
      <SFSymbol name="chevron.down" size={11} tint={emphasized ? provider.accent : colors.tertiaryLabel} />
    </Pressable>
  );
}
