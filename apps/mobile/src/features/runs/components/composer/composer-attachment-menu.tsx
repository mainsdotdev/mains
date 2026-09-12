import { Camera } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as MediaLibrary from "expo-media-library";
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
import { dismissKeyboardAndWait } from "@/lib/keyboard-transition";

import { GlassSurface, SFSymbol, ThemedText } from "@/components/ui";
import { ComposerCameraPanel, type ComposerCameraFrame } from "./composer-camera-panel";
import { ComposerPhotosPanel } from "./composer-photos-panel";

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
  accent,
  includeFiles,
  onDismiss,
  onCameraDismiss,
  onPanelDismiss,
  onSelect,
  onCameraCapture,
  onPhotosAdd,
  onError,
}: {
  visible: boolean;
  anchor: ComposerAttachmentMenuAnchor | null;
  /** Tints the photo grid's selection, as it tints the send button. */
  accent: string;
  includeFiles: boolean;
  onDismiss: () => void;
  onCameraDismiss: () => void;
  /** Closes the menu outright, with no reverse morph, after a panel is done. */
  onPanelDismiss: () => void;
  onSelect: (source: ComposerAttachmentSource) => void;
  onCameraCapture: (
    capture: ComposerCameraCapture,
  ) => Promise<ComposerCameraFrame | null>;
  onPhotosAdd: (assetIds: string[]) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const openingCameraRef = useRef(false);
  const openingPhotosRef = useRef(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);

  // A panel that dismissed the whole menu never gets to unset its own flag —
  // the menu is only ever hidden, not unmounted, so without this the next tap
  // on the + would reopen straight into the camera or the grid. Reset while
  // rendering rather than in an effect: React re-runs this pass before it
  // paints, so the menu is never shown for a frame with a stale panel over it.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) {
      setCameraOpen(false);
      setPhotosOpen(false);
    }
  }

  if (!anchor) return null;

  /** Either expanded panel: the menu itself is put away for both. */
  const panelOpen = cameraOpen || photosOpen;

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
  const panelHorizontalInset = spacing.ms;
  const panelBottom = Math.max(insets.bottom, spacing.ms);
  const panelWidth = windowWidth - panelHorizontalInset * 2;
  const panelHeight = Math.min(
    panelWidth * 1.32,
    windowHeight - insets.top - panelBottom - spacing.xl,
  );
  const panelFrame: ComposerCameraFrame = {
    left: panelHorizontalInset,
    top: windowHeight - panelBottom - panelHeight,
    width: panelWidth,
    height: panelHeight,
  };
  const originX = anchor.x + anchor.width / 2 - left;
  const originY = anchor.y + anchor.height / 2 - top;
  const collapsedScaleX = anchor.width / MENU_WIDTH;
  const collapsedScaleY = anchor.height / height;
  // Deliberately scale-only. Any alpha below 1 makes UIKit composite the
  // subtree offscreen, and the native glass inside it loses its backdrop for
  // the life of the surface rather than for the length of the animation — the
  // panel then stays see-through until it is unmounted. The exit below may
  // still fade, because that view is torn down the moment it finishes.
  const expandFromButton: EntryExitAnimationFunction = () => {
    "worklet";
    const spring = { duration: 230, dampingRatio: 1 };
    return {
      initialValues: {
        transform: [{ scaleX: collapsedScaleX }, { scaleY: collapsedScaleY }],
      },
      animations: {
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
  // Reduce Motion gets no entrance rather than a cross-fade: a fade that
  // starts at opacity 0 is the one case expo-glass-effect calls out as leaving
  // the glass unrendered, and an instant menu is the more literal reading of
  // the setting anyway. The exit still fades — that view is going away.
  const entering = reduceMotion ? undefined : expandFromButton;
  const exiting = reduceMotion
    ? FadeOut.duration(motion.fast)
    : collapseIntoButton;

  const openCamera = async () => {
    if (openingCameraRef.current) return;
    openingCameraRef.current = true;
    try {
      // `Keyboard.dismiss()` only starts iOS's dismissal animation. Wait for
      // its completion before mounting the bottom-anchored camera, otherwise
      // both surfaces occupy the screen for the first camera frames.
      await dismissKeyboardAndWait(Keyboard);
      const currentPermission = await Camera.getCameraPermissionsAsync();
      const permission = currentPermission.granted
        ? currentPermission
        : await Camera.requestCameraPermissionsAsync();
      if (!permission.granted) {
        onError("Camera access is required to take a photo");
        onDismiss();
        return;
      }
      setCameraOpen(true);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not open the camera");
      onDismiss();
    } finally {
      openingCameraRef.current = false;
    }
  };

  const openPhotos = async () => {
    if (openingPhotosRef.current) return;
    openingPhotosRef.current = true;
    try {
      await dismissKeyboardAndWait(Keyboard);
      const currentPermission = await MediaLibrary.getPermissionsAsync();
      const permission = currentPermission.granted
        ? currentPermission
        : await MediaLibrary.requestPermissionsAsync();
      // Refusing library access is not a dead end. The system picker runs out
      // of process and needs no permission at all, so a "no" here falls back
      // to it rather than leaving the row inert.
      if (!permission.granted) {
        onSelect("photos");
        return;
      }
      // `limited` is left as it is: the grid then shows only the photos iOS
      // shared, and the panel's own All Photos control reaches the rest.
      setPhotosOpen(true);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not open your photos");
      onSelect("photos");
    } finally {
      openingPhotosRef.current = false;
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
          disabled={panelOpen}
          onPress={() => onDismiss()}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {visible ? (
        <Animated.View
          accessibilityElementsHidden={panelOpen}
          entering={entering}
          // The frame stays mounted, without its material, behind the camera
          // so the back control can restore it. A direct camera dismissal must
          // not run the menu's reverse morph: that exit animation starts at
          // opacity 1 and would flash the menu before collapsing it into the
          // + button.
          exiting={panelOpen ? undefined : exiting}
          importantForAccessibility={panelOpen ? "no-hide-descendants" : "auto"}
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
            // The material below is unmounted while the camera is up, so the
            // shadow is all that would still draw. Hiding the panel with
            // `opacity: 0` instead would cost it its glass permanently.
            boxShadow: panelOpen ? undefined : shadows.overlay,
          }}
          pointerEvents={panelOpen ? "none" : "auto"}
        >
          {panelOpen ? null : (
            <View
              style={{
                flex: 1,
                borderRadius: radius.xl + 8,
                borderCurve: "continuous",
                overflow: "hidden",
              }}
            >
              {/* The panel never leans on the native glass for its coverage.
                  Liquid Glass has no backdrop to refract inside a window overlay
                  until it initializes, and gives one up for good the moment an
                  ancestor is composited at less than full opacity, so an opaque
                  material sits below it: the worst case is then a flat card
                  rather than a transparent one. */}
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: colors.secondarySystemBackground },
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
                      } else if (action.id === "photos") {
                        void openPhotos();
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
          )}
        </Animated.View>
      ) : null}
      {visible && cameraOpen ? (
        <ComposerCameraPanel
          source={menuFrame}
          target={panelFrame}
          onCapture={onCameraCapture}
          onReturnToMenu={() => setCameraOpen(false)}
          onClose={onCameraDismiss}
          onError={onError}
        />
      ) : null}
      {visible && photosOpen ? (
        <ComposerPhotosPanel
          source={menuFrame}
          target={panelFrame}
          accent={accent}
          onAdd={onPhotosAdd}
          onOpenSystemPicker={() => onSelect("photos")}
          onReturnToMenu={() => setPhotosOpen(false)}
          onClose={onPanelDismiss}
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
