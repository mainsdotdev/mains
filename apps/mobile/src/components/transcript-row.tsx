import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
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
  type SharedValue,
} from "react-native-reanimated";

import { parsePromptContent } from "@/lib/prompt-chips";
import type { PromptImage, TranscriptItem } from "@/lib/transcript";
import { useSmoothText } from "@/lib/use-smooth-text";
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

export interface PromptMessageRect extends PromptBubbleRect {
  text: PromptBubbleRect | null;
  images: PromptBubbleRect[];
}

export interface PromptFlightElement {
  from: PromptBubbleRect;
  to: PromptBubbleRect;
}

/** Source and destination coordinates relative to the RunView root. */
export interface PromptFlight {
  text: PromptFlightElement | null;
  images: PromptFlightElement[];
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
  /** Window coordinates of the rendered prompt text and image surfaces. */
  onPromptMeasure?: (rect: PromptMessageRect) => void;
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
      {isLiveResponse ? <StreamingMarkdown source={item.text} /> : <Markdown source={item.text} />}
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

/** Mounted only for the live response, so settled history never replays the reveal. */
function StreamingMarkdown({ source }: { source: string }) {
  const displayedText = useSmoothText(source);
  return <Markdown source={displayedText} animateTail />;
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

const PROMPT_IMAGE_MAX_WIDTH = 296;
const PROMPT_IMAGE_SINGLE_ASPECT = 4 / 3;

function promptHasText(item: Extract<TranscriptItem, { kind: "prompt" }>): boolean {
  return item.text.trim().length > 0;
}

function measureView(view: View | null): Promise<PromptBubbleRect | null> {
  return new Promise((resolve) => {
    if (!view) {
      resolve(null);
      return;
    }
    view.measureInWindow((x, y, width, height) => {
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

function messageBounds(
  text: PromptBubbleRect | null,
  images: PromptBubbleRect[],
): PromptMessageRect | null {
  const elements = [...images, ...(text ? [text] : [])];
  if (elements.length === 0) return null;
  const x = Math.min(...elements.map((element) => element.x));
  const y = Math.min(...elements.map((element) => element.y));
  const right = Math.max(...elements.map((element) => element.x + element.width));
  const bottom = Math.max(...elements.map((element) => element.y + element.height));
  return { x, y, width: right - x, height: bottom - y, text, images };
}

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
  onMeasure?: (rect: PromptMessageRect) => void;
}) {
  const accent = useProviderAccent(providerId);
  const reduceMotion = useReducedMotion();
  const textRef = useRef<View>(null);
  const imageRefs = useRef(new Map<string, View>());
  const hasText = promptHasText(item);

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
        void Promise.all([
          hasText ? measureView(textRef.current) : Promise.resolve(null),
          ...item.images.map((image) => measureView(imageRefs.current.get(image.key) ?? null)),
        ]).then(([text, ...measuredImages]) => {
          if (cancelled) return;
          attempts++;
          if ((hasText && !text) || measuredImages.some((image) => !image)) {
            if (attempts < 12) sample();
            return;
          }
          const current = messageBounds(
            text,
            measuredImages.filter((image): image is PromptBubbleRect => image !== null),
          );
          if (!current) return;
          // The run view projects this live coordinate through any remaining
          // scroll distance, so the media and phrase move as one message.
          onMeasure(current);
        });
      });
    };

    sample();
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [hasText, item.images, onMeasure]);

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
      {item.images.length > 0 ? (
        <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
          <PromptImageGrid
            images={item.images}
            onImageRef={(key, view) => {
              if (view) imageRefs.current.set(key, view);
              else imageRefs.current.delete(key);
            }}
          />
          {hasText ? (
            <PromptBubbleSurface
              ref={textRef}
              item={item}
              accent={accent}
              maxWidth="100%"
            />
          ) : null}
        </View>
      ) : hasText ? (
        <PromptBubbleSurface ref={textRef} item={item} accent={accent} />
      ) : null}
    </Animated.View>
  );
}

/**
 * Visual copies of the composer's text and images. They share one critically
 * damped progress value, so every piece leaves and lands on the same frames.
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
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion
      ? withTiming(1, { duration: motion.base }, (finished) => {
          if (finished) runOnJS(onLanded)();
        })
      : withSpring(1, { duration: motion.slow, dampingRatio: 1 }, (finished) => {
          if (finished) runOnJS(onLanded)();
        });
  }, [onLanded, progress, reduceMotion]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 4 }]}>
      {flight.images.map((element, index) => {
        const image = item.images[index];
        return image ? (
          <FlyingPromptImage
            key={image.key}
            image={image}
            element={element}
            progress={progress}
            reduceMotion={reduceMotion}
          />
        ) : null;
      })}
      {flight.text ? (
        <FlyingPromptText
          item={item}
          accent={accent}
          element={flight.text}
          progress={progress}
          reduceMotion={reduceMotion}
        />
      ) : null}
    </View>
  );
}

function FlyingPromptImage({
  image,
  element,
  progress,
  reduceMotion,
}: {
  image: PromptImage;
  element: PromptFlightElement;
  progress: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const value = progress.value;
    return {
      left: reduceMotion ? element.to.x : interpolate(value, [0, 1], [element.from.x, element.to.x]),
      top: reduceMotion ? element.to.y : interpolate(value, [0, 1], [element.from.y, element.to.y]),
      width: reduceMotion
        ? element.to.width
        : interpolate(value, [0, 1], [element.from.width, element.to.width]),
      height: reduceMotion
        ? element.to.height
        : interpolate(value, [0, 1], [element.from.height, element.to.height]),
      opacity: reduceMotion ? value : 1,
      borderRadius: interpolate(value, [0, 1], [radius.lg, radius.xl], Extrapolation.CLAMP),
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          borderCurve: "continuous",
          overflow: "hidden",
          backgroundColor: colors.fill,
        },
        animatedStyle,
      ]}
    >
      <Image
        source={{ uri: image.uri }}
        contentFit="cover"
        style={
          image.previewCropBottom
            ? {
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: `${100 / (1 - image.previewCropBottom)}%` as `${number}%`,
              }
            : StyleSheet.absoluteFill
        }
      />
    </Animated.View>
  );
}

function FlyingPromptText({
  item,
  accent,
  element,
  progress,
  reduceMotion,
}: {
  item: Extract<TranscriptItem, { kind: "prompt" }>;
  accent: string;
  element: PromptFlightElement;
  progress: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const initialX = element.from.x - element.to.x;
  const initialY = element.from.y - element.to.y;
  const flightStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? progress.value : 1,
    transform: [
      {
        translateX: reduceMotion
          ? 0
          : interpolate(progress.value, [0, 1], [initialX, 0]),
      },
      {
        translateY: reduceMotion
          ? 0
          : interpolate(progress.value, [0, 1], [initialY, 0]),
      },
    ],
  }));
  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.12, 1], [0, 0, 1], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(progress.value, [0, 1], [0.98, 1], Extrapolation.CLAMP),
      },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: element.to.x,
          top: element.to.y,
          width: element.to.width,
        },
        flightStyle,
      ]}
    >
      <View
        style={{
          width: element.to.width,
          position: "relative",
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.ms,
        }}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: promptBubbleRadius(item),
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

function PromptImageGrid({
  images,
  onImageRef,
}: {
  images: PromptImage[];
  onImageRef?: (key: string, view: View | null) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const gridWidth = Math.min(PROMPT_IMAGE_MAX_WIDTH, windowWidth * 0.84);
  const tileWidth =
    images.length === 1 ? gridWidth : (gridWidth - spacing.xs) / 2;
  const tileHeight =
    images.length === 1 ? tileWidth / PROMPT_IMAGE_SINGLE_ASPECT : tileWidth;

  return (
    <View
      style={{
        width: gridWidth,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: spacing.xs,
      }}
    >
      {images.map((image) => (
        <View
          key={image.key}
          ref={(view) => onImageRef?.(image.key, view)}
          style={{
            width: tileWidth,
            height: tileHeight,
            borderRadius: radius.xl,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: colors.fill,
          }}
        >
          <Image
            accessible
            accessibilityLabel={image.name}
            source={{ uri: image.uri }}
            contentFit="cover"
            transition={motion.fast}
            style={
              image.previewCropBottom
                ? {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: tileWidth,
                    height: tileHeight / (1 - image.previewCropBottom),
                  }
                : { flex: 1 }
            }
          />
        </View>
      ))}
    </View>
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
  maxWidth = "84%",
}: {
  ref?: React.Ref<View>;
  item: Extract<TranscriptItem, { kind: "prompt" }>;
  accent: string;
  width?: number;
  maxWidth?: `${number}%`;
}) {
  return (
    <View
      ref={ref}
      style={{
        ...(width === undefined ? { maxWidth } : { width }),
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
