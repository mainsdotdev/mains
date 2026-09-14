import * as Haptics from "expo-haptics";

import { Card, Row } from "@/components/ui";
import {
  APPEARANCE_PREFERENCES,
  appearanceLabel,
  setAppearancePreference,
  useAppearancePreference,
  type AppearancePreference,
} from "@/lib/appearance";

/** What each choice actually does, said once under its name. */
const SUBTITLES: Record<AppearancePreference, string | undefined> = {
  system: "Follow the phone's Display & Brightness setting",
  light: undefined,
  dark: undefined,
};

/**
 * The appearance picker for Settings: a grouped card of System / Light / Dark
 * with a check on the current one, in the same language as the rest of the
 * screen. Choosing writes through immediately — there is no Done to press and
 * nothing to confirm, because the whole app repaints under the tap.
 */
export function AppearanceCard() {
  const preference = useAppearancePreference();

  const choose = (next: AppearancePreference) => {
    if (next === preference) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAppearancePreference(next);
  };

  return (
    <Card>
      {APPEARANCE_PREFERENCES.map((option, index) => (
        <Row
          key={option}
          first={index === 0}
          title={appearanceLabel(option)}
          subtitle={SUBTITLES[option]}
          selected={option === preference}
          onPress={() => choose(option)}
        />
      ))}
    </Card>
  );
}
