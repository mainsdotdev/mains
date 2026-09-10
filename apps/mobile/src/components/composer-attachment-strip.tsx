import { Image } from "expo-image";
import { useRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from "react-native-reanimated";

import type { ComposerAttachment } from "@/lib/composer-attachments";
import { colors, motion, radius, spacing } from "@/theme";

import { SFSymbol } from "./sf-symbol";
import { ThemedText } from "./themed-text";

const IMAGE_PREVIEW_SIZE = 104;

export interface ComposerAttachmentPreviewFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ComposerAttachmentStrip({
  attachments,
  onRemove,
  onImageRef,
  transitioningImageId,
  onTransitioningImageLayout,
}: {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
  onImageRef?: (id: string, view: View | null) => void;
  transitioningImageId?: string | null;
  onTransitioningImageLayout?: (
    id: string,
    frame: ComposerAttachmentPreviewFrame,
  ) => void;
}) {
  const reduceMotion = useReducedMotion();
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => attachment.type === "image");
  const documents = attachments.filter((attachment) => attachment.type === "document");

  return (
    <View style={{ gap: spacing.sm }}>
      {images.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm }}
        >
          {images.map((attachment) => (
            <ImageAttachmentPreview
              key={attachment.id}
              attachment={attachment}
              onRemove={onRemove}
              onRef={onImageRef}
              reduceMotion={reduceMotion}
              transitioning={attachment.id === transitioningImageId}
              onLayout={onTransitioningImageLayout}
            />
          ))}
        </ScrollView>
      ) : null}

      {documents.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm }}
        >
          {documents.map((attachment) => (
            <Animated.View
              key={attachment.id}
              entering={FadeIn.duration(motion.fast)}
              exiting={FadeOut.duration(motion.fast)}
              layout={reduceMotion ? undefined : LinearTransition.duration(motion.fast)}
              style={{
                maxWidth: 176,
                height: 36,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingLeft: spacing.xs,
                paddingRight: spacing.xs,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: colors.fill,
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.sm,
                  borderCurve: "continuous",
                  backgroundColor: colors.fill,
                }}
              >
                <SFSymbol name="doc" size={15} tint={colors.secondaryLabel} />
              </View>
              <ThemedText
                variant="caption"
                numberOfLines={1}
                style={{ flexShrink: 1, color: colors.label }}
              >
                {attachment.name}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.name}`}
                hitSlop={8}
                onPress={() => onRemove(attachment.id)}
                style={({ pressed }) => ({
                  padding: spacing.xxs,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <SFSymbol name="xmark" size={10} tint={colors.secondaryLabel} />
              </Pressable>
            </Animated.View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function ImageAttachmentPreview({
  attachment,
  onRemove,
  onRef,
  reduceMotion,
  transitioning,
  onLayout,
}: {
  attachment: ComposerAttachment;
  onRemove: (id: string) => void;
  onRef?: (id: string, view: View | null) => void;
  reduceMotion: boolean;
  transitioning: boolean;
  onLayout?: (id: string, frame: ComposerAttachmentPreviewFrame) => void;
}) {
  const previewRef = useRef<View>(null);

  const measureInWindow = () => {
    if (!transitioning || !onLayout) return;
    requestAnimationFrame(() => {
      previewRef.current?.measureInWindow((left, top, width, height) => {
        if (width <= 0 || height <= 0) return;
        onLayout(attachment.id, { left, top, width, height });
      });
    });
  };

  return (
    <Animated.View
      ref={(view: View | null) => {
        previewRef.current = view;
        onRef?.(attachment.id, view);
      }}
      accessibilityElementsHidden={transitioning}
      entering={transitioning ? undefined : FadeIn.duration(motion.fast)}
      exiting={FadeOut.duration(motion.fast)}
      layout={reduceMotion ? undefined : LinearTransition.duration(motion.fast)}
      onLayout={measureInWindow}
      pointerEvents={transitioning ? "none" : "auto"}
      style={{
        width: IMAGE_PREVIEW_SIZE,
        height: IMAGE_PREVIEW_SIZE,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: colors.fill,
        opacity: transitioning ? 0 : 1,
      }}
    >
      <Image
        accessible
        accessibilityLabel={attachment.name}
        source={{ uri: attachment.uri }}
        contentFit="cover"
        transition={motion.fast}
        style={
          attachment.previewCropBottom
            ? {
                position: "absolute",
                left: 0,
                top: 0,
                width: IMAGE_PREVIEW_SIZE,
                height: IMAGE_PREVIEW_SIZE / (1 - attachment.previewCropBottom),
              }
            : { flex: 1 }
        }
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${attachment.name}`}
        hitSlop={8}
        onPress={() => onRemove(attachment.id)}
        style={({ pressed }) => ({
          position: "absolute",
          top: spacing.sm,
          right: spacing.sm,
          width: 26,
          height: 26,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0, 0, 0, 0.62)",
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <SFSymbol name="xmark" size={11} tint={colors.onTint} />
      </Pressable>
    </Animated.View>
  );
}
