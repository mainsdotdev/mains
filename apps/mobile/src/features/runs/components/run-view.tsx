import { useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View, type NativeScrollEvent } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from "react-native-reanimated";
// Not Reanimated's: its own hook is deprecated (iOS bugs) and points here.
import { useAnimatedKeyboard } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { backendSession } from "@/backend/backend-session";
import { RoundGlassButton, ThemedText } from "@/components/ui";
import type { ComposerAttachment } from "@/lib/composer-attachments";
import { projectedPromptLandingY } from "@/lib/prompt-flight";
import type { PromptSkill } from "@/lib/prompt-chips";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { colors, motion, radius, shadows, spacing } from "@/theme";
import type {
  ComposerSendOrigin,
  PendingPrompt,
  PromptBubbleRect,
  PromptMessageRect,
} from "../types";
import { useRunData } from "../hooks/use-run-data";
import { useOptimisticPrompt } from "../hooks/use-optimistic-prompt";
import { useRunOperations } from "../hooks/use-run-operations";

import { AsciiLoader } from "./ascii-loader";
import { ComposerBar, composerBottomPadding } from "./composer/composer-bar";
import { PendingApprovalCard } from "./approvals/pending-approval-card";
import {
  FlyingPromptBubble,
  PROMPT_BUBBLE_ROW_PADDING,
  TranscriptRow,
  type TranscriptActions,
} from "./transcript/transcript-row";
import { TranscriptTurn } from "./transcript/transcript-turn";

/**
 * How far above the end a reader can rest and still count as following it. At
 * the true end the list sits a home-indicator inset *past* its content, so this
 * allows about a composer's height of drift before the chase lets go.
 */
const PIN_DISTANCE = 80;

/**
 * How far above the end the reader has to be before the way back down is
 * offered. Further than the chase threshold, so that letting go just shy of
 * the end — where the list still follows on its own — does not flash a button
 * for the one thing already happening.
 */
const JUMP_DISTANCE = 220;

/**
 * A run's conversation: its transcript, the agent's progress, any approval it
 * is waiting on, and the composer to continue or stop it. The run screen shows
 * one under a navigation bar; home shows the run it just started under its
 * floating controls — the same view, so a send never has to change screens.
 */
export function RunView({
  runId,
  pending = null,
  providerId: expectedProviderId = null,
  topInset,
  topPadding = 0,
}: {
  /** Empty while a send is still waiting on the Mac for its id. */
  runId: string;
  /** What was just sent, shown as the first bubble until the transcript has it. */
  pending?: PendingPrompt | null;
  /** The provider expected to answer — tints the bubble before the run row lands. */
  providerId?: string | null;
  /**
   * How far iOS insets the top of the list on this screen: the navigation
   * bar's height under a header, the status bar's without one. The scroll
   * model needs it to tell "at rest" from "scrolled under the title".
   */
  topInset: number;
  /** Content padding beneath that inset, for controls floating over the list. */
  topPadding?: number;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Two sheets behind the composer's two chips: the model (and its effort)
  // behind the model chip, how the agent may act behind the permission chip.
  const openModel = (providerId: string) =>
    router.push({ pathname: "/model", params: { providerId } } as Href);
  const openRunOptions = (providerId: string) =>
    router.push({ pathname: "/run-options", params: { providerId } } as Href);

  const {
    backend: { id: backendId, connected },
    run: { record: run, isLive: runIsLive, providerId, mode, workspacePath },
    transcript: { items, streamingItems, thinking },
    approvals: { waiting, now },
    modelSelection,
  } = useRunData(runId, expectedProviderId);
  /** Sent, but the Mac has yet to answer with a run. */
  const starting = pending !== null && !run;

  // On home's first send this is a newly mounted composer. Repeating the
  // source text here keeps it continuously visible until the flying layer is
  // ready to take over from the exact same place.
  const [draft, setDraft] = useState(() =>
    pending?.origin ? (pending.sourceText ?? pending.text) : "",
  );
  const [contextSkills, setContextSkills] = useState<PromptSkill[]>([]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(() =>
    pending?.origin ? (pending.attachments ?? []) : [],
  );
  const rootRef = useRef<View>(null);
  /** Following the end: cleared by a drag, restored by letting go near it. */
  const pinned = useRef(true);
  const clearComposerSource = useCallback(() => {
    setDraft("");
    setContextSkills([]);
    setAttachments([]);
  }, []);
  const {
    transcript: { rows, trailingStreamingRows, actionState, turnIsActive },
    initialPresentation,
    continuationPresentation,
    measuringLaunch,
    flyingPrompt,
    startContinuation,
    rollbackContinuation,
    resolveMeasurement,
    failMeasurement,
    landFlight,
  } = useOptimisticPrompt({
    runId,
    initialPrompt: pending,
    durableItems: items,
    streamingItems,
    runIsLive: Boolean(runIsLive),
    releaseComposerSource: clearComposerSource,
  });

  const measurePromptDestination = (target: PromptMessageRect) => {
    if (!measuringLaunch) return;
    const { id: launchId, origin } = measuringLaunch;
    const root = rootRef.current;
    if (!root) {
      failMeasurement(launchId);
      return;
    }
    root.measureInWindow((rootX, rootY) => {
      // A transparent header does not participate in Yoga layout. Even if
      // iOS reports the list's first rest offset a frame late, never let the
      // measured landing point enter the header/toolbar's reserved region.
      const reservedTargetTop =
        topPadding +
        spacing.sm +
        PROMPT_BUBBLE_ROW_PADDING +
        (process.env.EXPO_OS === "ios" ? topInset : 0);
      const { frame, content, offset } = metrics.current;
      const finalScrollOffset = Math.max(
        process.env.EXPO_OS === "ios" ? -topInset : 0,
        content - frame + (process.env.EXPO_OS === "ios" ? insets.bottom : 0),
      );
      const targetY = projectedPromptLandingY({
        measuredWindowY: target.y,
        rootWindowY: rootY,
        currentScrollOffset: offset,
        finalScrollOffset,
        reservedTop: reservedTargetTop,
      });
      const projectedDeltaY = targetY - target.y;
      const relativeTarget = (rect: PromptBubbleRect): PromptBubbleRect => ({
        x: rect.x - rootX,
        y: rect.y - rootY + projectedDeltaY,
        width: rect.width,
        height: rect.height,
      });
      resolveMeasurement(launchId, {
        text: target.text
          ? {
              from: {
                x: origin.x - rootX,
                y: origin.y - rootY,
                width: target.text.width,
                height: target.text.height,
              },
              to: relativeTarget(target.text),
            }
          : null,
        images: target.images.map((imageTarget, index) => {
          // Origins created before this media-aware send flow (for example
          // during Fast Refresh) have no image list. Falling back to the text
          // origin still completes the handoff.
          const source = origin.images?.[index];
          return {
            from: source
              ? {
                  x: source.x - rootX,
                  y: source.y - rootY,
                  width: source.width,
                  height: source.height,
                }
              : {
                  x: origin.x - rootX,
                  y: origin.y - rootY,
                  width: imageTarget.width,
                  height: imageTarget.height,
                },
            to: relativeTarget(imageTarget),
          };
        }),
      });
    });
  };

  const {
    continueRun,
    forkRun,
    stopRun,
    sending,
    forking,
    error: sendError,
  } = useRunOperations({
    run: run ?? null,
    turnIsActive,
    modelId: modelSelection.selected?.id ?? null,
  });

  const send = (origin: ComposerSendOrigin | null) => {
    const sentDraft = draft;
    const sentContextSkills = contextSkills;
    const sentAttachments = attachments;
    void continueRun(
      {
        sourceText: sentDraft,
        contextSkills: sentContextSkills,
        attachments: sentAttachments,
      },
      {
        onOptimisticStart: ({ message, skills }) => {
          startContinuation({
            text: message,
            sourceText: sentDraft,
            skills,
            origin,
            attachments: sentAttachments,
          });
          pinned.current = true;
        },
        onOptimisticRollback: () => {
          rollbackContinuation();
          setDraft(sentDraft);
          setContextSkills(sentContextSkills);
          setAttachments(sentAttachments);
        },
      },
    );
  };

  // Forking branches this run's session into a new one and opens it. The Mac
  // inherits everything else from the source, so the phone sends only the
  // opening line — the desktop's, word for word.
  const fork = useCallback(async () => {
    const nextRunId = await forkRun();
    if (nextRunId) router.push(`/run/${nextRunId}` as Href);
  }, [forkRun, router]);

  const actions = useMemo<TranscriptActions | undefined>(
    () =>
      run
        ? {
            ...actionState,
            forkDisabled: turnIsActive || forking,
            // A fork starts a run on the Mac; without one in reach, the button
            // has nothing to offer, so it stays off the row entirely.
            onFork: connected ? fork : undefined,
          }
        : undefined,
    [actionState, connected, fork, forking, run, turnIsActive],
  );

  const listRef = useRef<ScrollView>(null);

  // Room for the keyboard under the transcript, as padding: a short transcript
  // stays where it is, a long one can still be scrolled clear of the keys.
  const keyboardInset = useKeyboardInset();
  const composerHeight = 72 + insets.bottom;
  /**
   * Where the scroll indicator runs: the strip of list the reader can actually
   * see. iOS already keeps it clear of the header and the home indicator; these
   * add what floats over the list on top of that — the controls under the
   * title, the composer over the end. Without them the indicator spanned the
   * whole screen, behind the composer, reading as one bar the height of the
   * phone.
   */
  const indicatorInsets = {
    top: topPadding,
    bottom: composerHeight - insets.bottom + keyboardInset,
  };

  /**
   * Where the transcript sits, in a chat's terms: it opens on its last message
   * and follows the end while the reader stays near it; the moment they scroll
   * up to read, it holds still until they come back.
   *
   * The offsets are worked out here, from what the list reports, because the
   * native `scrollToEnd` knows nothing of the insets iOS adds for the
   * transparent header and the home indicator: it tucked a short transcript up
   * under the title and stopped an inset short of the true end on a long one.
   * `scrollToOverflowEnabled` is what lets the header's negative rest offset
   * through.
   */
  const metrics = useRef({ frame: 0, content: 0, offset: null as number | null });
  /** Whether the way back down is on screen; the ref keeps `onScroll` cheap. */
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const away = useRef(false);
  /**
   * The height of everything pinned to the bottom — the composer and the room
   * left under it. Measured rather than assumed, because the bar grows with a
   * long draft, an error line, or a strip of attachments, and the button that
   * floats over it has to know where its top edge ended up.
   */
  const [composerBox, setComposerBox] = useState(0);
  /** Set a beat after the transcript first lands; only moves after that animate. */
  const placed = useRef(false);
  const placedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (placedTimer.current) clearTimeout(placedTimer.current);
    },
    [],
  );
  // Only iOS insets the content for the header and the home indicator.
  const restOffset = process.env.EXPO_OS === "ios" ? -topInset : 0;
  const bottomInset = process.env.EXPO_OS === "ios" ? insets.bottom : 0;

  /** Whether the reader is far enough above the end to be offered a way back. */
  const reviewJump = () => {
    const { frame, content, offset } = metrics.current;
    if (frame === 0 || content === 0 || offset === null) return;
    const next = content - frame + bottomInset - offset > JUMP_DISTANCE;
    if (next === away.current) return;
    away.current = next;
    setAwayFromEnd(next);
  };

  /** The scroll itself. Everything else that has to follow it lives in `place`. */
  const scrollIntoPlace = (animated: boolean) => {
    const { frame, content, offset } = metrics.current;
    if (frame === 0 || content === 0) return;
    const end = content - frame + bottomInset;
    // A transcript that fits stays at rest under the header; scrolling a short
    // one "to the end" is what used to slide its first message off the top.
    const max = Math.max(restOffset, end);
    // `null` means native has not reported its initial offset. Do not assume
    // it already equals `restOffset`: home's transparent floating header does
    // not always receive an automatic inset on its first native layout.
    const current = offset;
    // Unpinned, the only move is back into range: when the content shrinks
    // under the reader — a turn folding as its run settles — iOS leaves the
    // offset past the end, showing nothing, until something scrolls.
    if (!pinned.current && current !== null && current <= max) return;
    if (current !== null && Math.abs(max - current) < 1) return;
    // An animated scroll reports its presentation offset through `onScroll`.
    // Writing the destination here would make a bubble measured mid-animation
    // believe the list had already arrived and project to the wrong place.
    const shouldAnimate = animated && current !== null;
    listRef.current?.scrollTo({ y: max, animated: shouldAnimate });
    if (!shouldAnimate) metrics.current.offset = max;
  };

  /** Move to wherever the transcript should be, if that is somewhere else. */
  const place = (animated = placed.current) => {
    scrollIntoPlace(animated);
    // Every path through the scroll leaves the button's answer possibly stale:
    // an unpinned list whose content shrank under the reader never moves, and
    // an unanimated landing reports no scroll of its own.
    reviewJump();
  };

  /** The way back down: start following the end again, then go to it. */
  const jumpToEnd = () => {
    pinned.current = true;
    place(true);
  };

  /** Re-read whether the reader is at the end once a scroll comes to rest. */
  const settle = (event: NativeScrollEvent) => {
    const { contentOffset, contentSize, layoutMeasurement, targetContentOffset } = event;
    // A fling reports where it will stop; judge by that rather than by where
    // the finger left, or a flick up from the end would be chased straight back.
    const y = targetContentOffset?.y ?? contentOffset.y;
    pinned.current = contentSize.height - layoutMeasurement.height - y < PIN_DISTANCE;
  };

  // The composer rides the keyboard itself, as the workspace screen's bar does:
  // an absolutely positioned child sees none of a KeyboardAvoidingView's
  // padding, so the wrapper only ever cost us — nested inside it the transcript
  // stopped being the screen's primary scroll view, and iOS dropped the
  // nav-bar inset that keeps content from sliding under the title.
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.value - insets.bottom) }],
  }));

  const placeholder = !connected
    ? "Connect to your Mac to continue this run"
    : runIsLive
      ? "The agent is still working…"
      : !run
        ? starting
          ? "Starting the run…"
          : "Loading run…"
        : "Continue this run…";
  return (
    <View ref={rootRef} collapsable={false} style={{ flex: 1 }}>
      {/*
        A ScrollView rather than a FlatList. The rows are whole turns, of which
        a run has a few dozen at most, and a virtualized list sizes what it has
        not rendered yet by estimate — an "end" that keeps moving as the tail
        fills in, which is no place to land a chat. Rendered whole, a fold also
        keeps its open state when it scrolls out of view.
      */}
      <ScrollView
        ref={listRef}
        contentInsetAdjustmentBehavior="automatic"
        scrollToOverflowEnabled
        scrollIndicatorInsets={indicatorInsets}
        scrollEventThrottle={16}
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm + topPadding,
          paddingBottom: composerHeight + spacing.md + keyboardInset,
          gap: spacing.md,
        }}
        onLayout={(event) => {
          metrics.current.frame = event.nativeEvent.layout.height;
          place();
        }}
        onContentSizeChange={(_width, height) => {
          metrics.current.content = height;
          // Existing rows and the outgoing phrase move as one continuous
          // transition. The phrase projects its destination through whatever
          // distance remains in this native scroll.
          place(placed.current || continuationPresentation !== null);
          // The first rows land in one piece and without animation; from a
          // beat later on, growth — a streaming answer, the keyboard's room —
          // is followed with one.
          if ((rows.length > 0 || initialPresentation !== null) && placedTimer.current === null) {
            placedTimer.current = setTimeout(() => {
              placed.current = true;
            }, 300);
          }
        }}
        onScroll={(event) => {
          metrics.current.offset = event.nativeEvent.contentOffset.y;
          reviewJump();
        }}
        onScrollBeginDrag={() => {
          pinned.current = false;
        }}
        onScrollEndDrag={(event) => settle(event.nativeEvent)}
        onMomentumScrollEnd={(event) => settle(event.nativeEvent)}
      >
        {initialPresentation ? (
          <TranscriptRow
            item={initialPresentation.item}
            providerId={providerId}
            animatePromptEntry={initialPresentation.animateEntry}
            promptHidden={initialPresentation.hidden}
            onPromptMeasure={
              initialPresentation.shouldMeasure ? measurePromptDestination : undefined
            }
          />
        ) : null}
        {rows.length === 0 && !initialPresentation ? (
          <ThemedText variant="subhead" style={{ paddingVertical: spacing.xl, textAlign: "center" }}>
            {run ? "Nothing in this run yet." : "Loading run…"}
          </ThemedText>
        ) : (
          rows.map((row, index) => (
            <TranscriptTurn
              key={row.key}
              row={row}
              providerId={providerId}
              // A local continuation already owns the new turn. Do not mark
              // the previous persisted turn live while that prompt flies in.
              isRunInProgress={
                Boolean(runIsLive) && !continuationPresentation && index === rows.length - 1
              }
              actions={actions}
            />
          ))
        )}
        {continuationPresentation ? (
          <TranscriptRow
            item={continuationPresentation.item}
            providerId={providerId}
            animatePromptEntry={continuationPresentation.animateEntry}
            promptHidden={continuationPresentation.hidden}
            onPromptMeasure={
              continuationPresentation.shouldMeasure ? measurePromptDestination : undefined
            }
          />
        ) : null}
        {trailingStreamingRows.map((row) => (
          <TranscriptTurn
            key={row.key}
            row={row}
            providerId={providerId}
            isRunInProgress={Boolean(runIsLive)}
            actions={actions}
          />
        ))}
        <View style={{ gap: spacing.md }}>
          {runIsLive || starting || continuationPresentation ? (
            <AsciiLoader mode={mode} thinkingText={thinking} />
          ) : null}
          {waiting.map((approval) => (
            <PendingApprovalCard
              key={approval.requestId}
              approval={approval}
              now={now}
              providerId={providerId}
              onRespond={async ({ approved, answer }) => {
                const result = await backendSession.respondToApproval(
                  approval.requestId,
                  approved,
                  answer,
                );
                if (!result.success) throw new Error(result.error);
              }}
            />
          ))}
          {run?.lastError ? (
            <View
              style={{
                padding: spacing.md,
                borderRadius: radius.lg,
                borderCurve: "continuous",
                backgroundColor: colors.groupedCell,
                boxShadow: shadows.card,
                gap: spacing.xs,
              }}
            >
              <ThemedText variant="caption" style={{ color: colors.systemRed, fontWeight: "600" }}>
                RUN FAILED
              </ThemedText>
              <ThemedText variant="subhead" selectable>
                {run.lastError}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: composerBottomPadding(insets.bottom),
          },
          lift,
        ]}
        onLayout={(event) => setComposerBox(event.nativeEvent.layout.height)}
      >
        <ComposerBar
          reservedTop={topInset + topPadding + spacing.sm}
          value={draft}
          onChangeText={setDraft}
          onSend={(origin) => void send(origin)}
          // Only offered while there is something to stop, and only when the
          // Mac is reachable to hear it.
          onStop={runIsLive && connected ? () => void stopRun() : undefined}
          sending={sending}
          disabled={!connected || turnIsActive || !run}
          error={sendError}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          placeholder={placeholder}
          model={
            providerId && modelSelection.label
              ? {
                  label: modelSelection.label,
                  effort: modelSelection.effortLabel,
                  onPress: () => openModel(providerId),
                }
              : null
          }
          permission={
            providerId && modelSelection.permissionLabel
              ? { label: modelSelection.permissionLabel, onPress: () => openRunOptions(providerId) }
              : null
          }
          providerId={providerId || undefined}
          context={
            backendId && providerId
              ? {
                  backendId,
                  providerId,
                  workspacePath,
                  skills: contextSkills,
                  onSkillsChange: setContextSkills,
                }
              : null
          }
        />

        {/*
          The way back down, over the composer and riding the keyboard with it.
          Placed against this bar's measured height — a percentage of it cannot
          be resolved, the bar having no height of its own but what its content
          gives it, and the button landed behind the composer instead of above
          it. Last in the tree so it draws over the glass either way.
        */}
        {awayFromEnd && composerBox > 0 ? (
          <Animated.View
            entering={FadeIn.duration(motion.fast)}
            exiting={FadeOut.duration(motion.fast)}
            pointerEvents="box-none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: composerBox + spacing.sm,
              alignItems: "center",
            }}
          >
            <RoundGlassButton
              icon="arrow.down"
              label="Jump to the latest"
              size={34}
              onPress={jumpToEnd}
            />
          </Animated.View>
        ) : null}
      </Animated.View>

      {flyingPrompt ? (
        <FlyingPromptBubble
          item={flyingPrompt.item}
          providerId={providerId}
          flight={flyingPrompt.flight}
          onLanded={() => landFlight(flyingPrompt.launchId)}
        />
      ) : null}
    </View>
  );
}
