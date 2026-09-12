import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  Share,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SFSymbol, ThemedText } from "@/components/ui";
import { loadImage } from "@/features/runs";
import type { ArtifactImage } from "@mains/contracts/runs";
import { spacing } from "@/theme";

/** How far a pinch may take the image, and where a double tap lands it. */
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
/** An unzoomed image pulled this far, or this fast, is let go of. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;
const SPRING = { damping: 22, stiffness: 260, mass: 0.8 };

function clamp(value: number, low: number, high: number): number {
  "worklet";
  return Math.min(high, Math.max(low, value));
}

/** The file extension a shared copy should carry, from what the Mac sent. */
function extensionFor(mime: string): string {
  const subtype = mime.split("/")[1] ?? "";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype || "img";
}

/**
 * An image artifact, full screen: pinch and drag to look closer, double-tap
 * to jump in and out, pull it down to let it go. The share button hands the
 * pixels to the system sheet, whose "Save Image" is the way into Photos.
 * Presented over the transcript as a transparent modal, so the fade is the
 * only transition and the chat is still there underneath.
 */
export default function ImageViewerScreen() {
  const { artifactId: idParam, fileName: nameParam } = useLocalSearchParams<{
    artifactId: string;
    fileName?: string;
  }>();
  const artifactId = Number(idParam);
  const fileName =
    typeof nameParam === "string" && nameParam ? nameParam : "image";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const [image, setImage] = useState<ArtifactImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [measured, setMeasured] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [chrome, setChrome] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadImage(artifactId).then(
      (loaded) => {
        if (!cancelled) setImage(loaded);
      },
      (caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load this image",
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  const close = () => router.back();
  const toggleChrome = () => setChrome((on) => !on);

  const share = async () => {
    if (!image) return;
    try {
      const base = fileName.replace(/\.[^.]+$/, "") || "image";
      const file = new File(
        Paths.cache,
        `${base}-${artifactId}.${extensionFor(image.mime)}`,
      );
      await Promise.resolve(file.write(image.base64, { encoding: "base64" }));
      await Share.share({ url: file.uri });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not share this image",
      );
    }
  };

  // The image at rest: fitted inside the screen, its shape kept. A file the
  // Mac sent untouched arrives unmeasured and takes the decoder's word on load.
  const size =
    image && image.width !== null && image.height !== null
      ? { width: image.width, height: image.height }
      : measured;
  const fit = size
    ? Math.min(windowWidth / size.width, windowHeight / size.height)
    : 1;
  const shownWidth = size ? size.width * fit : windowWidth;
  const shownHeight = size ? size.height * fit : windowHeight * 0.6;

  // Gesture state lives on the UI thread; the JS side only hears "close".
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  /** A vertical pull on the unzoomed image — the way out. */
  const pull = useSharedValue(0);

  /** Bring a zoomed image back within the screen's edges. */
  const settle = () => {
    "worklet";
    const maxX = Math.max(0, (shownWidth * scale.value - windowWidth) / 2);
    const maxY = Math.max(0, (shownHeight * scale.value - windowHeight) / 2);
    const x = clamp(translateX.value, -maxX, maxX);
    const y = clamp(translateY.value, -maxY, maxY);
    translateX.value = withSpring(x, SPRING);
    translateY.value = withSpring(y, SPRING);
    savedX.value = x;
    savedY.value = y;
  };

  const reset = () => {
    "worklet";
    scale.value = withTiming(1);
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedScale.value = 1;
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = clamp(savedScale.value * event.scale, 1, MAX_SCALE);
    })
    .onEnd(() => {
      if (scale.value < 1.02) {
        reset();
        return;
      }
      savedScale.value = scale.value;
      settle();
    });

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      if (scale.value > 1 || savedScale.value > 1) {
        translateX.value = savedX.value + event.translationX;
        translateY.value = savedY.value + event.translationY;
      } else {
        pull.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (scale.value > 1 || savedScale.value > 1) {
        settle();
        return;
      }
      if (
        Math.abs(pull.value) > DISMISS_DISTANCE ||
        Math.abs(event.velocityY) > DISMISS_VELOCITY
      ) {
        runOnJS(close)();
      } else {
        pull.value = withSpring(0, SPRING);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event, success) => {
      if (!success) return;
      if (scale.value > 1) {
        reset();
        return;
      }
      // Zoom toward the tapped point, as far as the edges allow.
      const maxX = Math.max(
        0,
        (shownWidth * DOUBLE_TAP_SCALE - windowWidth) / 2,
      );
      const maxY = Math.max(
        0,
        (shownHeight * DOUBLE_TAP_SCALE - windowHeight) / 2,
      );
      const x = clamp(
        (windowWidth / 2 - event.x) * (DOUBLE_TAP_SCALE - 1),
        -maxX,
        maxX,
      );
      const y = clamp(
        (windowHeight / 2 - event.y) * (DOUBLE_TAP_SCALE - 1),
        -maxY,
        maxY,
      );
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      translateX.value = withTiming(x);
      translateY.value = withTiming(y);
      savedScale.value = DOUBLE_TAP_SCALE;
      savedX.value = x;
      savedY.value = y;
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd((_event, success) => {
      if (success) runOnJS(toggleChrome)();
    });

  const gesture = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value + pull.value },
      { scale: scale.value },
    ],
  }));
  // The ground thins as the image is pulled away, so letting go reads as leaving.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(pull.value) / 320) * 0.7,
  }));

  return (
    <View style={{ flex: 1 }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "#000" },
          backdropStyle,
        ]}
      />

      <GestureDetector gesture={gesture}>
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          {image ? (
            <Animated.View
              style={[{ width: shownWidth, height: shownHeight }, imageStyle]}
            >
              <Image
                source={{ uri: `data:${image.mime};base64,${image.base64}` }}
                style={{ width: "100%", height: "100%" }}
                contentFit="contain"
                accessibilityLabel={fileName}
                onLoad={(event) => {
                  if (!size)
                    setMeasured({
                      width: event.source.width,
                      height: event.source.height,
                    });
                }}
              />
            </Animated.View>
          ) : error ? (
            <ThemedText
              variant="subhead"
              style={{
                color: "#fff",
                paddingHorizontal: spacing.xl,
                textAlign: "center",
              }}
            >
              {error}
            </ThemedText>
          ) : null}
        </View>
      </GestureDetector>

      {chrome ? (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: insets.top + spacing.sm,
            left: spacing.md,
            right: spacing.md,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <ViewerButton icon="xmark" label="Close" onPress={close} size={18} />
          <ViewerButton
            icon="square.and.arrow.up"
            label="Share"
            onPress={() => void share()}
            disabled={!image}
            size={22}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A round, translucent button that reads over any picture. */
function ViewerButton({
  icon,
  label,
  onPress,
  size,
  disabled = false,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.16)",
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <SFSymbol name={icon} size={size} tint="#fff" />
    </Pressable>
  );
}
