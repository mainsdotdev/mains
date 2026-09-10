import { Camera } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";

import { colors, motion, radius, shadows, spacing } from "@/theme";
import type { ComposerCameraCapture } from "@/lib/composer-attachments";

import { GlassSurface } from "./glass-surface";
import { ComposerCameraPanel, type ComposerCameraFrame } from "./composer-camera-panel";
import { SFSymbol } from "./sf-symbol";
import { ThemedText } from "./themed-text";

export type ComposerAttachmentSource = "camera" | "photos" | "files";

export const COMPOSER_ATTACHMENT_MENU_COLLAPSE_MS = 180;
/** Keeps the window overlay alive a frame beyond the perceptual collapse. */
export const COMPOSER_ATTACHMENT_MENU_CLOSE_MS = COMPOSER_ATTACHMENT_MENU_COLLAPSE_MS + 40;

export interface ComposerAttachmentMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MENU_WIDTH = 260;
const ROW_HEIGHT = 64;
const MENU_PADDING = spacing.xs;

const ALL_ACTIONS: {
  id: ComposerAttachmentSource;
  label: string;
  icon: string;
}[] = [
  { id: "camera", label: "Camera", icon: "camera" },
  { id: "photos", label: "Photos", icon: "photo" },
  { id: "files", label: "Files", icon: "paperclip" },
];

/**
 * A small anchored source picker, shaped like the Claude composer's menu.
 *
 * On iOS it uses a focus-preserving window overlay instead of a modal, so the
 * keyboard does not jump. The scale origin is the centre of the + control, so
 * the glass appears to grow out of the control. The expanded material overlaps
 * that control, leaving the original button underneath the translucent glass.
 */
export function ComposerAttachmentMenu({
  visible,
  anchor,
  includeFiles,
  onDismiss,
  onCameraDismiss,
  onSelect,
  onCameraCapture,
  onError,
}: {
  visible: boolean;
  anchor: ComposerAttachmentMenuAnchor | null;
  includeFiles: boolean;
  onDismiss: () => void;
  onCameraDismiss: () => void;
  onSelect: (source: ComposerAttachmentSource) => void;
  onCameraCapture: (
    capture: ComposerCameraCapture,
  ) => Promise<ComposerCameraFrame | null>;
  onError: (message: string) => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const openingCameraRef = useRef(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  if (!anchor) return null;

  const actions = includeFiles ? ALL_ACTIONS : ALL_ACTIONS.slice(0, 2);
  const height = actions.length * ROW_HEIGHT + MENU_PADDING * 2;
  const left = Math.max(
    spacing.ms,
    Math.min(anchor.x - spacing.lg, windowWidth - MENU_WIDTH - spacing.ms),
  );
  // The open panel and the + share their lower edge. This is what makes the
  // control remain visibly underneath the glass instead of reading as a
  // detached popover above it.
  const top = anchor.y + anchor.height - height;
  const menuFrame: ComposerCameraFrame = {
    left,
    top,
    width: MENU_WIDTH,
    height,
  };
  const cameraHorizontalInset = spacing.ms;
  const cameraBottom = Math.max(insets.bottom, spacing.ms);
  const cameraWidth = windowWidth - cameraHorizontalInset * 2;
  const cameraHeight = Math.min(
    cameraWidth * 1.32,
    windowHeight - insets.top - cameraBottom - spacing.xl,
  );
  const cameraFrame: ComposerCameraFrame = {
    left: cameraHorizontalInset,
    top: windowHeight - cameraBottom - cameraHeight,
    width: cameraWidth,
    height: cameraHeight,
  };
  const originX = anchor.x + anchor.width / 2 - left;
  const originY = anchor.y + anchor.height / 2 - top;
  const collapsedScaleX = anchor.width / MENU_WIDTH;
  const collapsedScaleY = anchor.height / height;
  const expandFromButton: EntryExitAnimationFunction = () => {
    "worklet";
    const spring = { duration: 230, dampingRatio: 1 };
    return {
      initialValues: {
        opacity: 0.5,
        transform: [{ scaleX: collapsedScaleX }, { scaleY: collapsedScaleY }],
      },
      animations: {
        opacity: withTiming(1, { duration: motion.fast }),
        transform: [
          { scaleX: withSpring(1, spring) },
          { scaleY: withSpring(1, spring) },
        ],
      },
    };
  };
  const collapseIntoButton: EntryExitAnimationFunction = () => {
    "worklet";
    const spring = { duration: COMPOSER_ATTACHMENT_MENU_COLLAPSE_MS, dampingRatio: 1 };
    return {
      initialValues: {
        opacity: 1,
        transform: [{ scaleX: 1 }, { scaleY: 1 }],
      },
      animations: {
        opacity: withTiming(0.4, { duration: motion.fast }),
        transform: [
          { scaleX: withSpring(collapsedScaleX, spring) },
          { scaleY: withSpring(collapsedScaleY, spring) },
        ],
      },
    };
  };
  const entering = reduceMotion
    ? FadeIn.duration(motion.fast)
    : expandFromButton;
  const exiting = reduceMotion
    ? FadeOut.duration(motion.fast)
    : collapseIntoButton;

  const openCamera = async () => {
    if (openingCameraRef.current) return;
    openingCameraRef.current = true;
    try {
      const currentPermission = await Camera.getCameraPermissionsAsync();
      const permission = currentPermission.granted
        ? currentPermission
        : await Camera.requestCameraPermissionsAsync();
      if (!permission.granted) {
        onError("Camera access is required to take a photo");
        onDismiss();
        return;
      }
      Keyboard.dismiss();
      setCameraOpen(true);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not open the camera");
      onDismiss();
    } finally {
      openingCameraRef.current = false;
    }
  };

  const content = (
    <View
      pointerEvents={visible ? "auto" : "none"}
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal={visible}
    >
      {visible ? (
        <Pressable
          accessibilityLabel="Close attachment menu"
          accessibilityRole="button"
          disabled={cameraOpen}
          onPress={() => onDismiss()}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {visible ? (
        <Animated.View
          accessibilityElementsHidden={cameraOpen}
          entering={entering}
          // The menu stays mounted, but hidden, behind the camera so the back
          // control can restore it. A direct camera dismissal must not run the
          // menu's reverse morph: that exit animation starts at opacity 1 and
          // would flash the menu before collapsing it into the + button.
          exiting={cameraOpen ? undefined : exiting}
          importantForAccessibility={cameraOpen ? "no-hide-descendants" : "auto"}
          style={{
            position: "absolute",
            zIndex: 1,
            left,
            top,
            width: MENU_WIDTH,
            height,
            borderRadius: radius.xl + 8,
            borderCurve: "continuous",
            transformOrigin: [originX, originY, 0],
            boxShadow: shadows.overlay,
            opacity: cameraOpen ? 0 : 1,
          }}
          pointerEvents={cameraOpen ? "none" : "auto"}
        >
          <View
            style={{
              flex: 1,
              borderRadius: radius.xl + 8,
              borderCurve: "continuous",
              overflow: "hidden",
            }}
          >
            {/* Native Liquid Glass can briefly miss its backdrop when a new
                window-overlay surface is scaled on its mounting frame. This
                adaptive material backing keeps the panel legible while the
                native refraction layer initializes (and if it ever drops a
                compositor frame). */}
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.secondarySystemBackground, opacity: 0.72 },
              ]}
            />
            <GlassSurface
              effect="regular"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: radius.xl + 8,
                  borderCurve: "continuous",
                },
              ]}
            />
            <View style={{ paddingVertical: MENU_PADDING }}>
              {actions.map((action) => (
                <Pressable
                  key={action.id}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    if (action.id === "camera") {
                      void openCamera();
                    } else {
                      onSelect(action.id);
                    }
                  }}
                  style={({ pressed }) => ({
                    height: ROW_HEIGHT,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.ms,
                    paddingHorizontal: spacing.md,
                    backgroundColor: pressed ? colors.fill : "transparent",
                  })}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: radius.full,
                      backgroundColor: colors.fill,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <SFSymbol name={action.icon} size={20} tint={colors.label} />
                  </View>
                  <ThemedText variant="body">{action.label}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        </Animated.View>
      ) : null}
      {visible && cameraOpen ? (
        <ComposerCameraPanel
          source={menuFrame}
          target={cameraFrame}
          onCapture={onCameraCapture}
          onReturnToMenu={() => setCameraOpen(false)}
          onClose={onCameraDismiss}
          onError={onError}
        />
      ) : null}
    </View>
  );

  if (Platform.OS === "ios") {
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal={visible}>
        {content}
      </FullWindowOverlay>
    );
  }

  return (
    <Modal
      animationType="none"
      onRequestClose={() => onDismiss()}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      {content}
    </Modal>
  );
}
