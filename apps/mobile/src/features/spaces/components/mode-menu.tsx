import { Host, Picker } from "@expo/ui";

import { modeLabel, type ModeId } from "@mains/contracts/runs";
import { radius, spacing } from "@/theme";

import { GlassSurface, ThemedText } from "@/components/ui";

/** Matches the round glass buttons beside the pill. */
const PILL_HEIGHT = 46;
/** Room for "Code" / "Work" / "Chat" at body size plus the menu chevron. */
const PICKER_WIDTH = 108;

/**
 * The mode control at the top of the home screen: one pill showing the
 * space's mode; tapping it opens the system's dropdown (SwiftUI menu picker
 * on iOS, Compose dropdown on Android) with Code / Work / Chat — only the
 * modes the space's provider drives. Choosing one edits the space's mode on
 * the Mac, exactly like the desktop's mode picker.
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
            selectedValue={value}
            appearance="menu"
            enabled={!pending}
            onValueChange={(next) => onChange(next as ModeId)}
          >
            {modes.map((mode) => (
              <Picker.Item key={mode} label={modeLabel(mode)} value={mode} />
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
