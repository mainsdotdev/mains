import MaskedView from "@react-native-masked-view/masked-view";
import { useEffect, useState } from "react";
import { Text, View, type TextStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { type ModeId } from "@mains/contracts/modes";
import { colors, type } from "@/theme";

/**
 * What the agent is said to be doing while a turn runs — the phone's port of
 * the desktop's `ascii-loader.tsx`, words and all.
 *
 * The words are the only thing on screen between turns, so they set the tone as
 * much as the prompt delta does: Developer talks about the work as engineering,
 * Work talks about it as knowledge work — the same rule that keeps the mode's
 * instructions from naming commands — and Chat sounds like someone thinking
 * rather than a machine processing.
 */
const LOADER_WORDS: Record<ModeId, readonly string[]> = {
  developer: [
    "Thinking",
    "Analyzing",
    "Searching",
    "Processing",
    "Generating",
    "Creating",
    "Evaluating",
    "Researching",
    "Refining",
    "Formulating",
  ],
  work: [
    "Working",
    "Reading",
    "Gathering",
    "Drafting",
    "Organizing",
    "Reviewing",
    "Summarizing",
    "Preparing",
    "Checking",
    "Pulling it together",
  ],
  chat: [
    "Thinking",
    "Reading",
    "Considering",
    "Looking into it",
    "Thinking it over",
    "Working it out",
    "Checking",
  ],
};

function pickWord(words: readonly string[]): string {
  return words[Math.floor(Math.random() * words.length)];
}

/** Strip markdown formatting for plain-text display. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/\*(.+?)\*/g, "$1") // *italic*
    .replace(/__(.+?)__/g, "$1") // __bold__
    .replace(/_(.+?)_/g, "$1") // _italic_
    .replace(/`(.+?)`/g, "$1") // `code`
    .replace(/^#+\s*/gm, ""); // # headings
}

/**
 * `.shine-text`, natively.
 *
 * The desktop paints a bright blob over a dim base and clips it to the glyphs
 * (`background-clip: text`). There is no such clip here, so the same picture is
 * built the other way round: a MaskedView takes the text as its mask, and what
 * shows through is a dim slab with a bright band sliding across it.
 *
 * Neither half costs a native rebuild. `masked-view` already ships inside the
 * app (expo-router pulls it for its header masks, and it is in the Podfile), and
 * the band is RN 0.86's `experimental_backgroundImage` — a style prop, not a
 * view. The alternative, `expo-linear-gradient`, is a native module we would
 * have to add and rebuild the dev client for, to draw three color stops.
 */
const SHINE_MS = 2000;

/** Fallback width until the line measures itself — one sweep on a stale width. */
const ASSUMED_WIDTH = 220;

export function AsciiLoader({ mode, thinkingText }: { mode: ModeId; thinkingText?: string }) {
  const words = LOADER_WORDS[mode] ?? LOADER_WORDS.developer;
  const [word, setWord] = useState(() => pickWord(words));

  useEffect(() => {
    const rotate = setInterval(() => setWord(pickWord(words)), 4000);
    return () => clearInterval(rotate);
  }, [words]);

  const content = thinkingText ? stripMarkdown(thinkingText) : word;
  const reduceMotion = useReducedMotion();

  const [width, setWidth] = useState(ASSUMED_WIDTH);
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      sweep.value = 0;
      return;
    }
    sweep.value = 0;
    sweep.value = withRepeat(withTiming(1, { duration: SHINE_MS, easing: Easing.linear }), -1, false);
  }, [reduceMotion, sweep]);

  const band = useAnimatedStyle(() => ({
    // Enters one band-width off the left edge, leaves one off the right.
    transform: [{ translateX: -width + sweep.value * (width * 2) }],
  }));

  const textStyle: TextStyle = { ...type.footnote, color: colors.label };

  // Reduced motion: the desktop kills the animation and leaves the text; so here.
  if (reduceMotion) {
    return (
      <Text numberOfLines={2} style={[type.footnote, { color: colors.secondaryLabel }]}>
        {content}
      </Text>
    );
  }

  return (
    <MaskedView
      maskElement={
        <Text numberOfLines={2} style={textStyle}>
          {content}
        </Text>
      }
    >
      {/* An invisible copy sizes the masked box; the mask itself is laid out
          separately by MaskedView and contributes nothing to layout. The slab
          stays full width on purpose — shrink-wrapping it would let this copy
          wrap at a different column than the mask's, and the glyphs would drift
          apart. Past the letters the slab is masked away anyway. */}
      <View
        style={{ backgroundColor: colors.tertiaryLabel }}
        onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width) || ASSUMED_WIDTH)}
      >
        <Text numberOfLines={2} style={[textStyle, { opacity: 0 }]}>
          {content}
        </Text>
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width,
              experimental_backgroundImage: [
                {
                  type: "linear-gradient",
                  direction: "to right",
                  colorStops: [
                    { color: "transparent", positions: ["0%"] },
                    { color: colors.label, positions: ["50%"] },
                    { color: "transparent", positions: ["100%"] },
                  ],
                },
              ],
            },
            band,
          ]}
        />
      </View>
    </MaskedView>
  );
}

/**
 * The latest thinking the agent surfaced, if any — a streamed `thinking`
 * artifact, else a legacy `[thinking] ` log line. Same order of preference as
 * the desktop's `latestThinking`.
 */
export function latestThinking(
  artifacts: { kind: string; content: string | null }[],
): string | undefined {
  for (let i = artifacts.length - 1; i >= 0; i--) {
    const artifact = artifacts[i];
    if (artifact.kind === "thinking" && artifact.content?.trim()) return artifact.content;
  }
  for (let i = artifacts.length - 1; i >= 0; i--) {
    const artifact = artifacts[i];
    if (artifact.kind === "log" && artifact.content?.startsWith("[thinking] ")) {
      return artifact.content.slice("[thinking] ".length);
    }
  }
  return undefined;
}
