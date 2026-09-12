import { Text } from "react-native";

import type { PromptSegment } from "@/lib/prompt-chips";
import { colors, useBrandColors } from "@/theme";

/**
 * A mention inside a prompt.
 *
 * These were chips — a rounded box with the plugin's artwork. They are plain
 * text now, weighted and tinted, because that is the one treatment that reads
 * the same in the two places a mention lives: a `Text` in the transcript, and
 * the composer's `TextInput`, which can hold styled ranges but never a box.
 *
 * (Fabric's `BaseTextInputShadowNode::getAttributedString` does walk a text
 * input's children into fragments, so a styled range there is reachable — but
 * only by dropping the `value` prop, which the JS layer forbids alongside
 * children, and driving the field from those children instead. The composer is
 * controlled today; see the note in `context-picker.ts`.)
 */
export function PromptMention({
  label,
  /** True inside the prompt bubble, which is already filled with the accent. */
  onAccent = false,
}: {
  label: string;
  onAccent?: boolean;
}) {
  const brand = useBrandColors();
  return (
    <Text
      style={{
        // Accent-on-accent would vanish, so weight alone carries the mention
        // over a tinted bubble — the surrounding text is the same white, a
        // step lighter.
        color: onAccent ? colors.onTint : brand.accent,
        fontWeight: "600",
      }}
    >
      {label}
    </Text>
  );
}

/** One segment of a prompt: prose as-is, a mention weighted and tinted. */
export function PromptSegmentView({
  segment,
  onAccent = false,
}: {
  segment: PromptSegment;
  onAccent?: boolean;
}) {
  switch (segment.kind) {
    case "text":
      return <>{segment.text}</>;
    case "skill":
      return (
        <PromptMention
          label={segment.skill.displayName || segment.skill.name}
          onAccent={onAccent}
        />
      );
    case "file":
      return <PromptMention label={segment.file.basename} onAccent={onAccent} />;
    case "code":
      return (
        <PromptMention
          label={`${segment.path.slice(segment.path.lastIndexOf("/") + 1)}:${segment.range}`}
          onAccent={onAccent}
        />
      );
  }
}
