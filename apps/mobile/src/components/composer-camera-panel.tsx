import { type CameraType, CameraView } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { ComposerCameraCapture } from "@/lib/composer-attachments";
import { colors, motion, radius, shadows, spacing } from "@/theme";

import { GlassSurface } from "./glass-surface";
import { SFSymbol } from "./sf-symbol";

export interface ComposerCameraFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CAMERA_MORPH_MS = 280;

/** Camera preview that grows from, and can return to, the attachment menu. */
export function ComposerCameraPanel({
  source,
  target,
  onCapture,
  onReturnToMenu,
  onClose,
  onError,
}: {
  source: ComposerCameraFrame;
  target: ComposerCameraFrame;
  onCapture: (
    capture: ComposerCameraCapture,
  ) => Promise<ComposerCameraFrame | null>;
  onReturnToMenu: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const cameraRef = useRef<CameraView>(null);
  const collapseCompletionRef = useRef<(() => void) | null>(null);
  const [facing, setFacing] = useState<CameraType>("back");
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<ComposerCameraCapture | null>(null);
  const reduceMotion = useReducedMotion();
  const left = useSharedValue(reduceMotion ? target.left : source.left);
  const top = useSharedValue(reduceMotion ? target.top : source.top);
  const width = useSharedValue(reduceMotion ? target.width : source.width);
  const height = useSharedValue(reduceMotion ? target.height : source.height);
  const controlsOpacity = useSharedValue(0);
  const surfaceOpacity = useSharedValue(1);
  const cornerRadius = useSharedValue(radius.xl + 10);

  const frameStyle = useAnimatedStyle(() => ({
    left: left.value,
    top: top.value,
    width: width.value,
    height: height.value,
    borderRadius: cornerRadius.value,
  }));
  const controlsStyle = useAnimatedStyle(() => ({ opacity: controlsOpacity.value }));
  const surfaceStyle = useAnimatedStyle(() => ({ opacity: surfaceOpacity.value }));

  useEffect(() => {
    if (reduceMotion) {
      left.set(target.left);
      top.set(target.top);
      width.set(target.width);
      height.set(target.height);
      controlsOpacity.set(withTiming(1, { duration: motion.fast }));
      return () => {
        cancelAnimation(controlsOpacity);
        cancelAnimation(surfaceOpacity);
        cancelAnimation(cornerRadius);
      };
    }

    const spring = { duration: CAMERA_MORPH_MS, dampingRatio: 1 };
    left.set(withSpring(target.left, spring));
    top.set(withSpring(target.top, spring));
    width.set(withSpring(target.width, spring));
    height.set(withSpring(target.height, spring));
    controlsOpacity.set(withDelay(100, withTiming(1, { duration: motion.fast })));

    return () => {
      cancelAnimation(left);
      cancelAnimation(top);
      cancelAnimation(width);
      cancelAnimation(height);
      cancelAnimation(controlsOpacity);
      cancelAnimation(surfaceOpacity);
      cancelAnimation(cornerRadius);
    };
  }, [
    controlsOpacity,
    cornerRadius,
    height,
    left,
    reduceMotion,
    surfaceOpacity,
    target.height,
    target.left,
    target.top,
    target.width,
    top,
    width,
  ]);

  const finishCollapse = () => {
    const completion = collapseCompletionRef.current;
    collapseCompletionRef.current = null;
    completion?.();
  };

  const collapse = (completion: () => void) => {
    if (collapseCompletionRef.current) return;
    collapseCompletionRef.current = completion;
    if (reduceMotion) {
      controlsOpacity.set(
        withTiming(0, { duration: motion.fast }, (finished) => {
          if (finished) runOnJS(finishCollapse)();
        }),
      );
      return;
    }
    const spring = { duration: CAMERA_MORPH_MS, dampingRatio: 1 };
    controlsOpacity.set(withTiming(0, { duration: motion.fast }));
    left.set(withSpring(source.left, spring));
    top.set(withSpring(source.top, spring));
    width.set(withSpring(source.width, spring));
    height.set(
      withSpring(source.height, spring, (finished) => {
        if (finished) runOnJS(finishCollapse)();
      }),
    );
    cornerRadius.set(withSpring(radius.xl + 8, spring));
  };

  const dismiss = (completion: () => void) => {
    if (collapseCompletionRef.current) return;
    collapseCompletionRef.current = completion;
    controlsOpacity.set(withTiming(0, { duration: motion.fast }));
    surfaceOpacity.set(
      withTiming(0, { duration: motion.fast }, (finished) => {
        if (finished) runOnJS(finishCollapse)();
      }),
    );
  };

  const landPhoto = (destination: ComposerCameraFrame) => {
    if (reduceMotion) {
      dismiss(onClose);
      return;
    }
    if (collapseCompletionRef.current) return;
    collapseCompletionRef.current = onClose;
    const spring = { duration: 340, dampingRatio: 1 };
    controlsOpacity.set(withTiming(0, { duration: motion.fast }));
    left.set(withSpring(destination.left, spring));
    top.set(withSpring(destination.top, spring));
    width.set(withSpring(destination.width, spring));
    height.set(
      withSpring(destination.height, spring, (finished) => {
        if (finished) runOnJS(finishCollapse)();
      }),
    );
    cornerRadius.set(withSpring(radius.lg, spring));
  };

  const closeFromCamera = () => {
    dismiss(onClose);
  };

  const takePhoto = async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      const capture = { uri: photo.uri, width: photo.width, height: photo.height };
      setCapturedPhoto(capture);
      controlsOpacity.set(withTiming(0, { duration: motion.fast }));
      const destination = await onCapture(capture);
      if (destination) {
        landPhoto(destination);
      } else {
        closeFromCamera();
      }
    } catch (caught) {
      setCapturing(false);
      onError(caught instanceof Error ? caught.message : "Could not take that photo");
    }
  };

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          zIndex: 2,
          borderRadius: radius.xl + 10,
          borderCurve: "continuous",
          overflow: "hidden",
          backgroundColor: "#000000",
          boxShadow: shadows.overlay,
        },
        frameStyle,
        surfaceStyle,
      ]}
    >
      <CameraView
        ref={cameraRef}
        active={!capturedPhoto}
        animateShutter
        facing={facing}
        flash={flashEnabled ? "on" : "off"}
        mirror={facing === "front"}
        mode="picture"
        onMountError={(event) => onError(event.message)}
        responsiveOrientationWhenOrientationLocked
        style={{ flex: 1 }}
      />

      {capturedPhoto ? (
        <Image
          source={{ uri: capturedPhoto.uri }}
          contentFit="cover"
          style={
            capturedPhoto.width === 200 && capturedPhoto.height === 200
              ? {
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: "100%",
                  height: "125%",
                }
              : { position: "absolute", inset: 0 }
          }
        />
      ) : null}

      <Animated.View
        pointerEvents={capturing ? "none" : "box-none"}
        style={[{ position: "absolute", inset: 0 }, controlsStyle]}
      >
        <CameraControl
          label="Back to attachment menu"
          icon="chevron.left"
          onPress={() => collapse(onReturnToMenu)}
          style={{ left: spacing.md, bottom: spacing.md }}
        />
        <CameraControl
          label={flashEnabled ? "Turn flash off" : "Turn flash on"}
          icon={flashEnabled ? "bolt.fill" : "bolt.slash.fill"}
          onPress={() => {
            void Haptics.selectionAsync();
            setFlashEnabled((enabled) => !enabled);
          }}
          style={{ right: spacing.md, bottom: 168 }}
        />
        <CameraControl
          label="Flip camera"
          icon="arrow.triangle.2.circlepath"
          onPress={() => {
            void Haptics.selectionAsync();
            setFacing((current) => (current === "back" ? "front" : "back"));
          }}
          style={{ right: spacing.md, bottom: 92 }}
        />
        <CameraControl
          label="Close camera"
          icon="xmark"
          onPress={closeFromCamera}
          style={{ right: spacing.md, bottom: spacing.md }}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          disabled={capturing}
          onPress={() => void takePhoto()}
          style={({ pressed }) => ({
            position: "absolute",
            left: "50%",
            bottom: spacing.md - 2,
            marginLeft: -38,
            width: 76,
            height: 76,
            borderRadius: radius.full,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.28)",
            borderWidth: 1,
            borderColor: "rgba(255, 255, 255, 0.36)",
            opacity: capturing ? 0.55 : pressed ? 0.8 : 1,
          })}
        >
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: radius.full,
              backgroundColor: "#ffffff",
            }}
          />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function CameraControl({
  label,
  icon,
  onPress,
  style,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  style: { left?: number; right?: number; bottom: number };
}) {
  return (
    <GlassSurface
      effect="clear"
      interactive
      style={{
        position: "absolute",
        ...style,
        width: 56,
        height: 56,
        borderRadius: radius.full,
        overflow: "hidden",
        backgroundColor: "rgba(0, 0, 0, 0.28)",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <SFSymbol name={icon} size={23} tint={colors.onTint} />
      </Pressable>
    </GlassSurface>
  );
}
