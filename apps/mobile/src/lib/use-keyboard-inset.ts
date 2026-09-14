import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, useWindowDimensions, type KeyboardMetrics } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * How much of the screen above the home indicator the keyboard covers — the
 * room a screen adds under its content, as padding, while the keys are up.
 *
 * Padding rather than `automaticallyAdjustKeyboardInsets`. That prop reserves
 * the same space natively, but on every keyboard change it also re-applies the
 * list's offset through a clamp blind to the transparent header's inset — so
 * the list snapped to y = 0, under the title. And it listens for every
 * keyboard, not just its screen's: a list sitting behind the run screen in the
 * stack was snapped there by the composer's keys going away, and came back
 * into view already broken.
 *
 * Two details keep the number honest:
 *  - it is read from where the keyboard's frame *lands*, not from its height —
 *    a keyboard on its way out still reports its full height, at a frame parked
 *    below the screen, and taken as a height that spiked the padding for a
 *    frame as the keys left;
 *  - it is 0 while the screen is not the focused one, so a keyboard raised by
 *    the screen on top is not something this one reacts to.
 */
export function useKeyboardInset(): number {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const focused = useIsFocused();
  // Tracked whether or not this screen is in front, so that coming back into
  // focus with the keys already up needs no catching up.
  const [covered, setCovered] = useState(() => coveredBy(Keyboard.metrics(), windowHeight));

  useEffect(() => {
    const changed = Keyboard.addListener("keyboardWillChangeFrame", (event) =>
      setCovered(coveredBy(event.endCoordinates, windowHeight)),
    );
    const hidden = Keyboard.addListener("keyboardWillHide", () => setCovered(0));
    return () => {
      changed.remove();
      hidden.remove();
    };
  }, [windowHeight]);

  return focused ? Math.max(0, covered - insets.bottom) : 0;
}

/** How much of a screen this tall a keyboard at this frame actually covers. */
function coveredBy(frame: KeyboardMetrics | undefined, windowHeight: number): number {
  if (!frame) return 0;
  return Math.max(0, Math.min(frame.height, windowHeight - frame.screenY));
}
