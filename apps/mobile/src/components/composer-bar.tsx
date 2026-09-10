import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View, useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  detectTrigger,
  replaceTrigger,
  skillContext,
  skillMention,
  type ContextTrigger,
  type PickerRow,
} from "@/lib/context-picker";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import {
  composerAttachmentFromCamera,
  composerAttachmentsFromLibrary,
  mergeComposerAttachments,
  pickComposerDocuments,
  pickComposerImages,
  type ComposerAttachment,
  type ComposerCameraCapture,
} from "@/lib/composer-attachments";
import type { PromptSkill } from "@/lib/prompt-chips";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { colors, radius, spacing, type, useProviderAccent } from "@/theme";

import { ContextPicker } from "./context-picker";
import {
  COMPOSER_ATTACHMENT_MENU_COLLAPSE_MS,
  COMPOSER_ATTACHMENT_MENU_CLOSE_MS,
  ComposerAttachmentMenu,
  type ComposerAttachmentMenuAnchor,
  type ComposerAttachmentSource,
} from "./composer-attachment-menu";
import {
  ComposerAttachmentStrip,
  type ComposerAttachmentPreviewFrame,
} from "./composer-attachment-strip";
import { GlassSurface } from "./glass-surface";
import { SFSymbol } from "./sf-symbol";
import { ThemedText } from "./themed-text";

/**
 * What the composer needs to offer its inline context menu. Attachments are
 * phone-local and therefore do not depend on this Mac-backed context source.
 */
export interface ComposerContext {
  backendId: string;
  providerId: string;
  /** The run target's folder on the Mac, when there is one. */
  workspacePath?: string | null;
  /** Skills attached to the next send; the caller passes them to the Mac. */
  skills: PromptSkill[];
  onSkillsChange: (skills: PromptSkill[]) => void;
}

/** Window coordinates where a sent bubble should emerge from the text field. */
export interface ComposerSendOrigin {
  x: number;
  y: number;
  /** Window coordinates of image thumbnails, in composer order. */
  images: ComposerSendImageOrigin[];
}

export interface ComposerSendImageOrigin {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const ATTACHMENT_BUTTON_REVEAL_MS = 80;
const CAMERA_ATTACHMENT_TARGET_TIMEOUT_MS = 700;
const COMPOSER_LAYOUT_TRANSITION = LinearTransition.springify()
  .duration(340)
  .dampingRatio(1);

interface WindowMeasurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

function measureComposerView(
  view: WindowMeasurable | null,
): Promise<Omit<ComposerSendImageOrigin, "id"> | null> {
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

/**
 * The floating glass composer, in two rows like the Claude app's: the text on
 * top; below it the attach button, the model pill (model + effort) and the
 * send button. Used to start a run on home and to continue one on the run
 * screen.
 */
export function ComposerBar({
  value,
  onChangeText,
  onSend,
  placeholder,
  disabled = false,
  sending = false,
  error,
  attachments = [],
  onAttachmentsChange,
  onStop,
  model,
  permission,
  context,
  providerId,
  reservedTop,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (origin: ComposerSendOrigin | null) => void;
  placeholder: string;
  disabled?: boolean;
  sending?: boolean;
  error?: string | null;
  /** Phone-local files waiting to travel with the next message. */
  attachments?: ComposerAttachment[];
  onAttachmentsChange?: (attachments: ComposerAttachment[]) => void;
  /**
   * Given only while a run is in flight: the send button becomes a stop button,
   * as it does on the desktop (`SendButton` swaps on `loading && onStop`).
   */
  onStop?: () => void;
  /** The model pill: what is selected, its effort, and what tapping opens. */
  model?: { label: string; effort?: string | null; onPress: () => void } | null;
  /** The permission-mode pill — worth seeing before sending from a phone. */
  permission?: { label: string; onPress: () => void } | null;
  /** Skills and commands behind the inline `@` / `/` / `$` triggers. */
  context?: ComposerContext | null;
  /** Tints the send button, the way the provider tints its prompt bubbles. */
  providerId?: string | null;
  /**
   * How far down from the top of the screen its floating controls reach — the
   * header, or home's buttons — so the context picker stops short of them.
   */
  reservedTop?: number;
}) {
  const accent = useProviderAccent(providerId);
  const canSend =
    !disabled && !sending && (value.trim().length > 0 || attachments.length > 0);
  const inputRef = useRef<TextInput>(null);
  const attachmentButtonRef = useRef<View>(null);
  const attachmentImageRefsRef = useRef(new Map<string, View>());
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [attachmentMenuAnchor, setAttachmentMenuAnchor] =
    useState<ComposerAttachmentMenuAnchor | null>(null);
  const attachmentMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentSourceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraLandingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraLandingResolverRef = useRef<
    ((frame: ComposerAttachmentPreviewFrame | null) => void) | null
  >(null);
  const [transitioningCameraAttachmentId, setTransitioningCameraAttachmentId] =
    useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const attachmentButtonOpacity = useSharedValue(1);
  const attachmentButtonAnimatedStyle = useAnimatedStyle(() => ({
    opacity: attachmentButtonOpacity.value,
  }));

  useEffect(
    () => () => {
      if (attachmentMenuCloseTimerRef.current) {
        clearTimeout(attachmentMenuCloseTimerRef.current);
      }
      if (attachmentSourceTimerRef.current) {
        clearTimeout(attachmentSourceTimerRef.current);
      }
      if (cameraLandingTimerRef.current) {
        clearTimeout(cameraLandingTimerRef.current);
      }
      cameraLandingResolverRef.current?.(null);
      cameraLandingResolverRef.current = null;
    },
    [],
  );

  const sendFromInput = () => {
    const input = inputRef.current;
    if (!input) {
      onSend(null);
      return;
    }
    const imageAttachments = attachments.filter((attachment) => attachment.type === "image");
    void Promise.all([
      measureComposerView(input),
      ...imageAttachments.map((attachment) =>
        measureComposerView(attachmentImageRefsRef.current.get(attachment.id) ?? null),
      ),
    ]).then(([inputRect, ...imageRects]) => {
      if (!inputRect) {
        onSend(null);
        return;
      }
      // Align the flying bubble's text with the input's text, accounting for
      // the two surfaces' different internal padding.
      onSend({
        x: inputRect.x + spacing.xs - spacing.md,
        y: inputRect.y + spacing.xs - spacing.ms,
        images: imageRects.flatMap((rect, index) =>
          rect ? [{ id: imageAttachments[index].id, ...rect }] : [],
        ),
      });
    });
  };

  // Plugins remain behind the inline context triggers, as on the desktop;
  // the toolbar's attachment control is reserved for images/documents.

  // The picker opens upward from the bar and may grow until it meets whatever
  // floats at the top of the screen — no further, or on a small phone with
  // the keyboard up its header ended up under the screen's controls. The bar's
  // top edge is known from the parts: the screen's bottom, less the keyboard,
  // less the padding every screen gives the bar, less the bar itself.
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const [barHeight, setBarHeight] = useState(0);
  const pickerMaxHeight = Math.max(
    160,
    windowHeight -
      keyboardInset -
      composerBottomPadding(insets.bottom) -
      barHeight -
      spacing.xs -
      (reservedTop ?? insets.top + spacing.sm),
  );
  const typed = context ? detectTrigger(value) : null;
  const trigger: ContextTrigger = typed?.trigger ?? "@";
  const menuVisible = Boolean(context) && typed !== null;

  const closeMenu = () => {
    // A typed trigger keeps the menu open on its own, so dismissing means
    // dropping the token — otherwise the sheet reopens on the next render.
    if (typed) onChangeText(replaceTrigger(value, typed, ""));
  };

  const pick = (row: PickerRow) => {
    if (!context) return;
    if (row.kind === "skill") {
      const picked = skillContext(row.skill);
      // The label lands where the trigger was, so the sentence still reads as
      // it was meant; `composeGoal` swaps it back to `$name` on the way out.
      const mention = skillMention(picked);
      onChangeText(
        typed
          ? replaceTrigger(value, typed, mention)
          : `${value}${value && !/\s$/.test(value) ? " " : ""}${mention} `,
      );
      if (!context.skills.some((s) => s.name === picked.name)) {
        context.onSkillsChange([...context.skills, picked]);
      }
    } else {
      // A command is not an attachment; it *is* the message, so it stays put.
      const replacement = `/${row.command.name}`;
      onChangeText(
        typed
          ? replaceTrigger(value, typed, replacement)
          : `${value}${value && !/\s$/.test(value) ? " " : ""}${replacement} `,
      );
    }
  };

  const addPicked = (picked: ComposerAttachment[]) => {
    if (!onAttachmentsChange || picked.length === 0) return;
    onAttachmentsChange(mergeComposerAttachments(attachments, picked));
    setAttachmentError(null);
  };

  const addLibraryPhotos = async (assetIds: string[]) => {
    addPicked(await composerAttachmentsFromLibrary(assetIds));
  };

  const pickImages = async () => {
    try {
      addPicked(await pickComposerImages());
    } catch (caught) {
      setAttachmentError(caught instanceof Error ? caught.message : "Could not open your photos");
    }
  };

  const resolveCameraLanding = (
    frame: ComposerAttachmentPreviewFrame | null,
  ) => {
    if (cameraLandingTimerRef.current) {
      clearTimeout(cameraLandingTimerRef.current);
      cameraLandingTimerRef.current = null;
    }
    const resolve = cameraLandingResolverRef.current;
    cameraLandingResolverRef.current = null;
    resolve?.(frame);
  };

  const addCameraPhoto = (
    capture: ComposerCameraCapture,
  ): Promise<ComposerAttachmentPreviewFrame | null> => {
    if (!onAttachmentsChange) return Promise.resolve(null);
    const attachment = composerAttachmentFromCamera(capture);
    resolveCameraLanding(null);

    return new Promise((resolve) => {
      cameraLandingResolverRef.current = resolve;
      setTransitioningCameraAttachmentId(attachment.id);
      onAttachmentsChange(mergeComposerAttachments(attachments, [attachment]));
      setAttachmentError(null);
      cameraLandingTimerRef.current = setTimeout(
        () => resolveCameraLanding(null),
        CAMERA_ATTACHMENT_TARGET_TIMEOUT_MS,
      );
    });
  };

  const finishCameraDismiss = () => {
    resolveCameraLanding(null);
    setTransitioningCameraAttachmentId(null);
    closeAttachmentMenu(true);
  };

  const pickDocuments = async () => {
    try {
      addPicked(await pickComposerDocuments());
    } catch (caught) {
      setAttachmentError(caught instanceof Error ? caught.message : "Could not open your documents");
    }
  };

  const openAttachments = () => {
    if (!onAttachmentsChange) return;
    if (attachmentMenuVisible) {
      closeAttachmentMenu();
      return;
    }
    setAttachmentError(null);
    const button = attachmentButtonRef.current;
    if (!button) return;
    button.measureInWindow((x, y, width, height) => {
      if (attachmentMenuCloseTimerRef.current) {
        clearTimeout(attachmentMenuCloseTimerRef.current);
        attachmentMenuCloseTimerRef.current = null;
      }
      if (attachmentSourceTimerRef.current) {
        clearTimeout(attachmentSourceTimerRef.current);
        attachmentSourceTimerRef.current = null;
      }
      setAttachmentMenuAnchor({ x, y, width, height });
      cancelAnimation(attachmentButtonOpacity);
      attachmentButtonOpacity.set(0);
      setAttachmentMenuVisible(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    });
  };

  const closeAttachmentMenu = (direct = false) => {
    setAttachmentMenuVisible(false);
    cancelAnimation(attachmentButtonOpacity);
    attachmentButtonOpacity.set(
      withDelay(
        direct
          ? 0
          : COMPOSER_ATTACHMENT_MENU_COLLAPSE_MS - ATTACHMENT_BUTTON_REVEAL_MS,
        withTiming(1, { duration: ATTACHMENT_BUTTON_REVEAL_MS }),
      ),
    );
    if (attachmentMenuCloseTimerRef.current) {
      clearTimeout(attachmentMenuCloseTimerRef.current);
    }
    attachmentMenuCloseTimerRef.current = setTimeout(() => {
      setAttachmentMenuAnchor(null);
      attachmentMenuCloseTimerRef.current = null;
    }, direct ? ATTACHMENT_BUTTON_REVEAL_MS : COMPOSER_ATTACHMENT_MENU_CLOSE_MS);
  };

  const chooseAttachmentSource = (source: ComposerAttachmentSource) => {
    // Let the glass collapse back into the + before iOS presents a native
    // picker over it; otherwise the first frame of the picker catches the menu.
    closeAttachmentMenu();
    attachmentSourceTimerRef.current = setTimeout(() => {
      attachmentSourceTimerRef.current = null;
      if (source === "photos") void pickImages();
      if (source === "files") void pickDocuments();
    }, COMPOSER_ATTACHMENT_MENU_CLOSE_MS);
  };

  return (
    <Animated.View
      layout={reduceMotion ? undefined : COMPOSER_LAYOUT_TRANSITION}
      style={{ paddingHorizontal: spacing.ms, gap: spacing.xs }}
      onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
    >
      {error || attachmentError ? (
        <ThemedText variant="footnote" style={{ color: colors.systemRed, paddingHorizontal: spacing.sm }}>
          {error || attachmentError}
        </ThemedText>
      ) : null}
      <GlassSurface
        style={{
          borderRadius: radius.xl + 8,
          borderCurve: "continuous",
          paddingHorizontal: spacing.ms,
          paddingTop: spacing.sm,
          paddingBottom: spacing.sm,
          gap: spacing.sm,
        }}
      >
        <ComposerAttachmentStrip
          attachments={attachments}
          onImageRef={(id, view) => {
            if (view) attachmentImageRefsRef.current.set(id, view);
            else attachmentImageRefsRef.current.delete(id);
          }}
          transitioningImageId={transitioningCameraAttachmentId}
          onTransitioningImageLayout={(id, frame) => {
            if (id === transitioningCameraAttachmentId) {
              resolveCameraLanding(frame);
            }
          }}
          onRemove={(id) =>
            onAttachmentsChange?.(
              attachments.filter((attachment) => attachment.id !== id),
            )
          }
        />

        <TextInput
          ref={inputRef}
          accessibilityLabel="Message"
          editable={!disabled && !sending}
          multiline
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.tertiaryLabel as string}
          style={[
            type.body,
            {
              minHeight: 32,
              maxHeight: 132,
              paddingHorizontal: spacing.xs,
              paddingTop: spacing.xs,
              paddingBottom: 0,
              color: colors.label,
            },
          ]}
          value={value}
        />

        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Animated.View
            accessibilityElementsHidden={attachmentMenuAnchor !== null}
            pointerEvents={attachmentMenuAnchor ? "none" : "auto"}
            style={attachmentButtonAnimatedStyle}
          >
            <RoundControl
              label={providerId === PROVIDER_IDS.codex ? "Upload image" : "Upload file or photo"}
              controlRef={attachmentButtonRef}
              onPress={openAttachments}
              disabled={!onAttachmentsChange}
            >
              <SFSymbol name="plus" size={18} tint={colors.label} />
            </RoundControl>
          </Animated.View>

          {model ? (
            <Pill
              label={`Model: ${model.label}${model.effort ? `, effort ${model.effort}` : ""}`}
              onPress={model.onPress}
            >
              <ThemedText variant="subhead" numberOfLines={1} style={{ fontWeight: "600", flexShrink: 1 }}>
                {model.label}
              </ThemedText>
              {model.effort ? (
                <ThemedText variant="subhead" numberOfLines={1} style={{ color: colors.secondaryLabel }}>
                  {model.effort}
                </ThemedText>
              ) : null}
            </Pill>
          ) : null}

          {permission ? (
            <Pill label={`Permissions: ${permission.label}`} onPress={permission.onPress}>
              <ThemedText variant="subhead" numberOfLines={1} style={{ fontWeight: "600" }}>
                {permission.label}
              </ThemedText>
            </Pill>
          ) : null}

          <View style={{ flex: 1 }} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={onStop ? "Stop run" : "Send"}
            // Stopping stays available while the composer itself is disabled —
            // a run in flight is exactly when the field is closed for typing.
            disabled={onStop ? false : !canSend}
            onPress={onStop ?? sendFromInput}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              // Always the provider's color, disabled or not: the button says
              // whose agent this is, and greying it out for an empty field made
              // the composer read as unavailable rather than simply idle.
              backgroundColor: accent,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <SFSymbol
              name={onStop ? "stop.fill" : sending ? "ellipsis" : "arrow.up"}
              size={onStop ? 13 : 16}
              tint={colors.onTint}
            />
          </Pressable>
        </View>
      </GlassSurface>

      <ComposerAttachmentMenu
        visible={attachmentMenuVisible}
        anchor={attachmentMenuAnchor}
        accent={accent}
        includeFiles={providerId !== PROVIDER_IDS.codex}
        onDismiss={() => closeAttachmentMenu()}
        onCameraDismiss={finishCameraDismiss}
        onPanelDismiss={() => closeAttachmentMenu(true)}
        onSelect={chooseAttachmentSource}
        onCameraCapture={addCameraPhoto}
        onPhotosAdd={addLibraryPhotos}
        onError={setAttachmentError}
      />

      {context ? (
        <ContextPicker
          visible={menuVisible}
          backendId={context.backendId}
          providerId={context.providerId}
          workspacePath={context.workspacePath}
          trigger={trigger}
          filter={typed?.filter ?? ""}
          maxHeight={pickerMaxHeight}
          onSelect={pick}
          onClose={closeMenu}
        />
      ) : null}
    </Animated.View>
  );
}

function Pill({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs + 2,
        height: 36,
        paddingHorizontal: spacing.xs,
        borderRadius: radius.full,
        opacity: pressed ? 0.7 : 1,
        flexShrink: 1,
      })}
    >
      {children}
    </Pressable>
  );
}

function RoundControl({
  label,
  onPress,
  disabled = false,
  controlRef,
  children,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  controlRef?: React.Ref<View>;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      ref={controlRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.fill,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

/**
 * The space every screen leaves under the composer: the home indicator plus
 * a little more. Shared so the bar can work out where its own top edge is.
 */
export function composerBottomPadding(bottomInset: number): number {
  return bottomInset + spacing.sm;
}
