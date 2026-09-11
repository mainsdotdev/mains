import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { colors, radius, spacing } from "@/theme";

import { CheckIcon, ClipboardIcon, ForkIcon } from "./desktop-icons";

/** How long the copy button stays acknowledged before it reads "Copy" again. */
const COPIED_FOR_MS = 2000;

/** The desktop's opening line for a fork — kept word for word (`workspace-events.tsx`). */
export const FORK_MESSAGE = "Continue from where this session left off.";

/**
 * The two things an answer affords once it is written: take it with you, or
 * branch off it. The desktop hangs the same pair off the end of a session in
 * its `SessionTimeBar`; here they sit under the message itself, since a phone
 * transcript has no time bar to hang them on.
 *
 * Copy sits under the last message of each agent turn and takes the whole
 * turn with it. Fork is rarer still: the Mac branches the provider's
 * *session*, not a point inside it, so it can only ever start from the run's
 * closing message — the caller decides which one that is and passes `onFork`
 * there alone.
 */
export function MessageActions({
  text,
  onFork,
  forkDisabled = false,
}: {
  /** The message, as written — the copy is the raw markdown, not the render. */
  text: string;
  /** Omitted wherever a fork can't start: mid-transcript or offline. */
  onFork?: () => Promise<void>;
  /** Keeps the settled fork point visible, but inert, while its next turn runs. */
  forkDisabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const ok = await Clipboard.setStringAsync(text);
    if (!ok) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
  };

  const fork = async () => {
    if (!onFork || forkDisabled || forking) return;
    setForking(true);
    try {
      await onFork();
    } finally {
      setForking(false);
    }
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.ms }}>
      <ActionButton accessibilityLabel="Copy to clipboard" onPress={() => void copy()}>
        {copied ? (
          <CheckIcon size={18} color={colors.secondaryLabel} />
        ) : (
          <ClipboardIcon size={18} color={colors.secondaryLabel} />
        )}
      </ActionButton>
      {onFork ? (
        <ActionButton
          accessibilityLabel="Fork run from here"
          busy={forking}
          disabled={forkDisabled}
          onPress={() => void fork()}
        >
          <ForkIcon size={18} color={colors.secondaryLabel} />
        </ActionButton>
      ) : null}
    </View>
  );
}

/** A quiet capsule around one glyph; the label is for screen readers alone. */
function ActionButton({
  children,
  accessibilityLabel,
  busy = false,
  disabled = false,
  onPress,
}: {
  children: React.ReactNode;
  accessibilityLabel: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const unavailable = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      hitSlop={spacing.sm}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingVertical: spacing.xs + 2,
        borderRadius: radius.md,
        borderCurve: "continuous",
        opacity: unavailable ? 0.5 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}
