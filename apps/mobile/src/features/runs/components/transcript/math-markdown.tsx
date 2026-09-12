import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, View, useColorScheme, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { estimateMathMarkdownHeight } from "@/lib/math-markdown-layout";
import { colors, spacing } from "@/theme";

import MathMarkdownDom from "./math-markdown-dom";

const PLACEHOLDER_EXIT_MS = 260;
const CONTENT_ENTER_DELAY_MS = 60;
const CONTENT_ENTER_MS = 420;

/**
 * Native loading shell around the isolated KaTeX WebView. Expo cannot know a
 * matchContents height until the DOM posts its first measurement, so reserve
 * an estimated slot instead of letting the transcript collapse to zero.
 */
export default function MathMarkdown({ source }: { source: string }) {
  const colorScheme = useColorScheme();
  const { width, fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const [transitionComplete, setTransitionComplete] = useState(false);
  const contentProgress = useSharedValue(0);
  const placeholderOpacity = useSharedValue(1);

  const estimatedHeight = useMemo(
    () => estimateMathMarkdownHeight(source, Math.max(220, width - spacing.md * 2), fontScale),
    [fontScale, source, width],
  );

  const handleReady = useCallback(async (height: number): Promise<void> => {
    if (Number.isFinite(height) && height > 0) setMeasuredHeight(Math.ceil(height));
    if (reduceMotion) {
      placeholderOpacity.set(0);
      contentProgress.set(1);
      setTransitionComplete(true);
    }
    setReady(true);
  }, [contentProgress, placeholderOpacity, reduceMotion]);

  const finishTransition = useCallback(() => setTransitionComplete(true), []);

  useEffect(() => {
    if (!ready || reduceMotion) return;

    // Portable `fade-through`: the placeholder leaves promptly while the real
    // content enters as one calm surface after a short perceptual delay.
    placeholderOpacity.set(withTiming(0, {
      duration: PLACEHOLDER_EXIT_MS,
      easing: Easing.bezier(0.4, 0, 1, 1),
    }));
    contentProgress.set(withDelay(
      CONTENT_ENTER_DELAY_MS,
      withTiming(
        1,
        {
          duration: CONTENT_ENTER_MS,
          easing: Easing.bezier(0.2, 0, 0, 1),
        },
        (finished) => {
          if (finished) runOnJS(finishTransition)();
        },
      ),
    ));
  }, [contentProgress, finishTransition, placeholderOpacity, ready, reduceMotion]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentProgress.value,
    transform: [
      { translateY: 6 * (1 - contentProgress.value) },
      { scale: 0.99 + 0.01 * contentProgress.value },
    ],
  }));
  const reservedHeight = measuredHeight ?? estimatedHeight;

  return (
    <View style={[styles.host, !transitionComplete && { minHeight: reservedHeight }]}>
      <Animated.View
        pointerEvents={ready ? "auto" : "none"}
        style={contentStyle}
      >
        <MathMarkdownDom
          source={source}
          dark={colorScheme === "dark"}
          fontScale={fontScale}
          openUrl={openMathLink}
          onReady={handleReady}
          dom={{
            matchContents: true,
            scrollEnabled: false,
            contentInsetAdjustmentBehavior: "never",
            style: { width: "100%", backgroundColor: "transparent" },
          }}
        />
      </Animated.View>

      {!transitionComplete ? (
        <MathMarkdownPlaceholder height={reservedHeight} opacity={placeholderOpacity} />
      ) : null}
    </View>
  );
}

async function openMathLink(href: string): Promise<void> {
  await Linking.openURL(href);
}

function MathMarkdownPlaceholder({
  height,
  opacity,
}: {
  height: number;
  opacity: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const lineCount = Math.max(3, Math.min(42, Math.round(height / 34)));
  const widths = ["92%", "76%", "86%", "64%", "81%"] as const;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.placeholder, animatedStyle]}
    >
      {Array.from({ length: lineCount }, (_, index) => (
        <View
          key={index}
          style={[
            styles.placeholderLine,
            { width: widths[index % widths.length] },
            index % 7 === 5 && styles.equationLine,
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "relative",
    width: "100%",
  },
  placeholder: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "space-around",
    paddingVertical: spacing.xs,
  },
  placeholderLine: {
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.fill,
  },
  equationLine: {
    height: 20,
    width: "68%",
  },
});
