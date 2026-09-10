import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";

import { parsePromptContent } from "@/lib/prompt-chips";
import type { TranscriptItem } from "@/lib/transcript";
import { colors, motion, radius, spacing, useProviderAccent } from "@/theme";

import { ImageGallery } from "./artifact-image";
import { Markdown } from "./markdown";
import { MessageActions } from "./message-actions";
import { PromptSegmentView } from "./prompt-chips";
import { ThemedText } from "./themed-text";
import { ToolBlock } from "./tools/tool-block";

/**
 * What the action row under an agent message may do. Threaded down from the
 * run screen, which is the only place that knows where the run ends and
 * whether the Mac is in reach.
 */
export interface TranscriptActions {
  /** The response still being written; its unfinished action row stays hidden. */
  liveResponseKey: string | null;
  /** The latest settled response from which the provider session can branch. */
  forkKey: string | null;
  /** Branch a new run off this one; absent when the Mac is out of reach. */
  onFork?: () => Promise<void>;
  /** A continuation is running, so preserve the fork button without accepting taps. */
  forkDisabled: boolean;
}

/**
 * The agent turn a row belongs to. One action row per turn, under its last
 * message, and what it copies is the whole turn — a turn's earlier messages
 * are its working-out, and reading them back one copy at a time was noise.
 */
export interface TurnActions {
  /** The turn's last agent message: the one that carries the action row. */
  lastResponseKey: string | null;
  /** Every agent message of the turn, in order, a blank line between. */
  text: string;
}

export interface PromptBubbleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Start and destination coordinates relative to the RunView root. */
export interface PromptFlight {
  from: Pick<PromptBubbleRect, "x" | "y">;
  to: PromptBubbleRect;
}

/** Space between a transcript row boundary and its prompt bubble surface. */
export const PROMPT_BUBBLE_ROW_PADDING = spacing.sm;

/**
 * One line of a transcript. The user speaks in a bubble tinted with the
 * provider that answered; the agent speaks flush to the column, the way the
 * desktop's transcript does; a tool call is a row that opens.
 */
export function TranscriptRow({
  item,
  providerId,
  actions,
  turn,
  animatePromptEntry = false,
  promptHidden = false,
  onPromptMeasure,
}: {
  item: TranscriptItem;
  /** The run's provider — decides the prompt bubble's color. */
  providerId?: string | null;
  /** Absent until the run loads — then the turn's last message gets its row. */
  actions?: TranscriptActions;
  /** Absent for a row outside any agent turn; then a message stands alone. */
  turn?: TurnActions;
  /** Optimistic sends rise into the transcript; persisted history stays still. */
  animatePromptEntry?: boolean;
  /** Holds the transcript destination open while its flying copy is visible. */
  promptHidden?: boolean;
  /** Window coordinates of the rendered prompt surface. */
  onPromptMeasure?: (rect: PromptBubbleRect) => void;
}) {
  switch (item.kind) {
    case "prompt":
      return (
        <PromptBubble
          item={item}
          providerId={providerId}
          animateEntry={animatePromptEntry}
          hidden={promptHidden}
          onMeasure={onPromptMeasure}
        />
      );
    case "tools":
      return <ToolBlock calls={item.calls} />;
    case "images":
      return <ImageGallery images={item.images} />;
    case "note":
      return (
        <ThemedText variant="monoCaption" selectable>
          {item.text}
        </ThemedText>
      );
    case "response":
      // "Still working" is the transcript's footer loader, not a badge on the
      // last message — the agent is working on the run, not on that paragraph.
      return <AgentMessage item={item} actions={actions} turn={turn} />;
  }
}

function AgentMessage({
  item,
  actions,
  turn,
}: {
  item: Extract<TranscriptItem, { kind: "response" }>;
  actions?: TranscriptActions;
  turn?: TurnActions;
}) {
  const isLiveResponse = item.key === actions?.liveResponseKey;
  const isForkPoint = item.key === actions?.forkKey;
  // Only the turn's last message carries the row, and a message the agent is
  // still writing isn't a message yet: no copy of a half-answer, and nothing
  // to fork from until the session settles.
  const isTurnEnd = !turn || item.key === turn.lastResponseKey;
  const showActions = actions && isTurnEnd && !isLiveResponse;

  return (
    <View style={{ gap: spacing.xs }}>
      <Markdown source={item.text} />
      {showActions ? (
        <MessageActions
          text={turn?.text ?? item.text}
          onFork={isForkPoint ? actions.onFork : undefined}
          forkDisabled={isForkPoint && actions.forkDisabled}
        />
      ) : null}
    </View>
  );
}

/** Up to this many characters, a prompt's bubble is too narrow for the full radius. */
const BRIEF_PROMPT_CHARS = 3;

/**
 * The sent bubble begins just above the composer, already mostly materialized,
 * then rises and settles without overshoot. Reanimated's duration-based spring
 * treats this as a perceptual duration (the physical settle is a little longer).
 */
const PROMPT_BUBBLE_ENTER: EntryExitAnimationFunction = () => {
  "worklet";
  const spring = { duration: 180, dampingRatio: 1 };
  return {
    initialValues: {
      opacity: 0.45,
      transform: [{ translateY: 28 }, { scale: 0.96 }],
    },
    animations: {
      opacity: withTiming(1, { duration: motion.fast }),
      transform: [
        { translateY: withSpring(0, spring) },
        { scale: withSpring(1, spring) },
      ],
    },
  };
};

/** Reduced Motion keeps the send acknowledgement without moving the bubble. */
const PROMPT_BUBBLE_FADE = FadeIn.duration(motion.fast);

function PromptBubble({
  item,
  providerId,
  animateEntry,
  hidden,
  onMeasure,
}: {
  item: Extract<TranscriptItem, { kind: "prompt" }>;
  providerId?: string | null;
  animateEntry: boolean;
  hidden: boolean;
  onMeasure?: (rect: PromptBubbleRect) => void;
}) {
  const accent = useProviderAccent(providerId);
  const reduceMotion = useReducedMotion();
  const bubbleRef = useRef<View>(null);

  useEffect(() => {
    if (!onMeasure) return;
    let cancelled = false;
    let frame: number | null = null;
    let attempts = 0;
    let warmupFrames = 2;

    const sample = () => {
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        if (--warmupFrames > 0) {
          sample();
          return;
        }
        bubbleRef.current?.measureInWindow((x, y, width, height) => {
          if (cancelled) return;
          attempts++;
          if (width <= 0 || height <= 0) {
            if (attempts < 12) sample();
            return;
          }

          const current = { x, y, width, height };
          // The run view projects this live coordinate through any remaining
          // scroll distance, so the phrase and transcript can move together.
          onMeasure(current);
        });
      });
    };

    sample();
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [onMeasure]);

  return (
    <Animated.View
      entering={
        animateEntry
          ? reduceMotion
            ? PROMPT_BUBBLE_FADE
            : PROMPT_BUBBLE_ENTER
          : undefined
      }
      style={{
        alignItems: "flex-end",
        paddingVertical: PROMPT_BUBBLE_ROW_PADDING,
        opacity: hidden ? 0 : 1,
      }}
    >
      <PromptBubbleSurface
        ref={bubbleRef}
        item={item}
        accent={accent}
      />
    </Animated.View>
  );
}

/**
 * A visual copy that leaves the input's text position and lands exactly over
 * the hidden transcript bubble. The horizontal and vertical springs are kept
 * independent so the diagonal path stays smooth on every message length.
 */
export function FlyingPromptBubble({
  item,
  providerId,
  flight,
  onLanded,
}: {
  item: Extract<TranscriptItem, { kind: "prompt" }>;
  providerId?: string | null;
  flight: PromptFlight;
  onLanded: () => void;
}) {
  const accent = useProviderAccent(providerId);
  const reduceMotion = useReducedMotion();
  const initialX = flight.from.x - flight.to.x;
  const initialY = flight.from.y - flight.to.y;
  const initialDistance = Math.max(1, Math.sqrt(initialX ** 2 + initialY ** 2));
  const translateX = useSharedValue(reduceMotion ? 0 : initialX);
  const translateY = useSharedValue(reduceMotion ? 0 : initialY);
  const backgroundOpacity = useSharedValue(0);
  const bubbleRadius = promptBubbleRadius(item);

  useEffect(() => {
    if (reduceMotion) {
      backgroundOpacity.value = withTiming(1, { duration: motion.base }, (finished) => {
        if (finished) runOnJS(onLanded)();
      });
      return;
    }

    // Duration is perceptual; Reanimated lets the critically damped spring
    // spend a little longer physically settling. The phrase stays fully
    // legible while the material forms behind it over the same journey.
    const spring = { duration: motion.slow, dampingRatio: 1 };
    translateX.value = withSpring(0, spring);
    translateY.value = withSpring(0, spring, (finished) => {
      if (finished) runOnJS(onLanded)();
    });
  }, [backgroundOpacity, onLanded, reduceMotion, translateX, translateY]);

  const flightStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));
  const backgroundStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: backgroundOpacity.value, transform: [{ scale: 1 }] };
    const remaining = Math.sqrt(translateX.value ** 2 + translateY.value ** 2);
    const progress = 1 - remaining / initialDistance;
    return {
      // Text owns the transition from its first frame. The material waits a
      // beat, then forms in direct proportion to distance travelled.
      opacity: interpolate(progress, [0, 0.12, 1], [0, 0, 1], Extrapolation.CLAMP),
      transform: [
        {
          scale: interpolate(progress, [0, 1], [0.98, 1], Extrapolation.CLAMP),
        },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: flight.to.x,
          top: flight.to.y,
          width: flight.to.width,
          zIndex: 4,
        },
        flightStyle,
      ]}
    >
      <View
        style={{
          width: flight.to.width,
          position: "relative",
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.ms,
        }}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: bubbleRadius,
              borderCurve: "continuous",
              backgroundColor: accent,
            },
            backgroundStyle,
          ]}
        />
        <PromptBubbleText item={item} />
      </View>
    </Animated.View>
  );
}

function promptBubbleRadius(item: Extract<TranscriptItem, { kind: "prompt" }>): number {
  const brief =
    item.skills.length === 0 &&
    item.files.length === 0 &&
    item.text.trim().length <= BRIEF_PROMPT_CHARS;
  return brief ? radius.lg + 4 : radius.xl;
}

function PromptBubbleText({ item }: { item: Extract<TranscriptItem, { kind: "prompt" }> }) {
  const { segments } = parsePromptContent(item.text, item.skills, item.files);
  return (
    <ThemedText variant="prose" selectable style={{ color: colors.onTint }}>
      {segments.map((segment, i) => (
        <PromptSegmentView key={i} segment={segment} onAccent />
      ))}
    </ThemedText>
  );
}

function PromptBubbleSurface({
  ref,
  item,
  accent,
  width,
}: {
  ref?: React.Ref<View>;
  item: Extract<TranscriptItem, { kind: "prompt" }>;
  accent: string;
  width?: number;
}) {
  return (
    <View
      ref={ref}
      style={{
        ...(width === undefined ? { maxWidth: "84%" as const } : { width }),
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.ms,
        borderRadius: promptBubbleRadius(item),
        borderCurve: "continuous",
        backgroundColor: accent,
      }}
    >
      <PromptBubbleText item={item} />
    </View>
  );
}
