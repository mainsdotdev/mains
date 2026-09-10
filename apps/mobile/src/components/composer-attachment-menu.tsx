import * as Haptics from "expo-haptics";
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";
import { FullWindowOverlay } from "react-native-screens";

import { colors, motion, radius, shadows, spacing } from "@/theme";

import { GlassSurface } from "./glass-surface";
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
  onSelect,
}: {
  visible: boolean;
  anchor: ComposerAttachmentMenuAnchor | null;
  includeFiles: boolean;
  onDismiss: () => void;
  onSelect: (source: ComposerAttachmentSource) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
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
          onPress={() => onDismiss()}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {visible ? (
        <Animated.View
          entering={entering}
          exiting={exiting}
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
          }}
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
                    onSelect(action.id);
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
