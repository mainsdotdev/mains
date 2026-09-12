import { Host } from "@expo/ui";
import { Picker, Text } from "@expo/ui/swift-ui";
import { fixedSize, lineLimit, pickerStyle, tag, tint } from "@expo/ui/swift-ui/modifiers";
import { useColorScheme } from "react-native";

import { modeLabel, type ModeId } from "@mains/contracts/runs";
import { radius, spacing } from "@/theme";

import { GlassSurface, ThemedText } from "@/components/ui";

/** Matches the round glass buttons beside the pill. */
const PILL_HEIGHT = 46;
/** Room for "Code" / "Work" / "Chat" at body size plus the menu chevron. */
const PICKER_WIDTH = 108;

/**
 * iOS: the SwiftUI menu-style picker, tinted to the label color so the pill
 * reads as one neutral control (the universal picker keeps the system's
 * accent on its chevron). Same contract as `mode-menu.tsx`.
 */
export function ModeMenu({
  modes,
  value,
  pending = false,
  onChange,
}: {
  modes: readonly ModeId[];
  value: ModeId;
  pending?: boolean;
  onChange: (mode: ModeId) => void;
}) {
  const scheme = useColorScheme();
  // The SwiftUI layer needs a concrete color, so this is the one place the
  // label color is spelled out instead of taken from `colors.label`.
  const labelColor = scheme === "dark" ? "#f2f2f7" : "#1c1c1e";

  return (
    <GlassSurface
      interactive
      style={{
        height: PILL_HEIGHT,
        paddingHorizontal: modes.length > 1 ? spacing.sm : spacing.ml,
        borderRadius: radius.full,
        justifyContent: "center",
      }}
    >
      {modes.length > 1 ? (
        // A fixed frame rather than `matchContents`: the pill's shape must not
        // depend on the native picker's measurement, which can arrive late or
        // wrong while the screen is re-laid out. The labels are all one short
        // word, and the picker centers itself inside the frame it is given.
        // `pending` dims the picker, not the glass — a translucent glass view
        // stops rendering as glass.
        <Host style={{ width: PICKER_WIDTH, height: PILL_HEIGHT, opacity: pending ? 0.6 : 1 }}>
          <Picker
            selection={value}
            onSelectionChange={(next) => {
              if (!pending) onChange(next as ModeId);
            }}
            // fixedSize keeps the label at its ideal width so it never wraps
            // ("Cod / e") when the frame is proposed narrower than it wants.
            modifiers={[pickerStyle("menu"), tint(labelColor), fixedSize({ horizontal: true }), lineLimit(1)]}
          >
            {modes.map((mode) => (
              <Text key={mode} modifiers={[tag(mode)]}>
                {modeLabel(mode)}
              </Text>
            ))}
          </Picker>
        </Host>
      ) : (
        <ThemedText variant="callout" style={{ fontWeight: "600", opacity: pending ? 0.6 : 1 }}>
          {modeLabel(value)}
        </ThemedText>
      )}
    </GlassSurface>
  );
}
