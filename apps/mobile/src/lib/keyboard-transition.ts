interface KeyboardHideSubscription {
  remove(): void;
}

/** The small part of React Native's Keyboard API this transition needs. */
export interface DismissableKeyboard {
  isVisible(): boolean;
  dismiss(): void;
  addListener(
    event: "keyboardDidHide",
    listener: () => void,
  ): KeyboardHideSubscription;
}

/**
 * Remove input focus and wait until the native keyboard is fully off-screen.
 * `dismiss()` starts an asynchronous iOS animation; mounting another bottom
 * surface in the same frame leaves both surfaces visible during that motion.
 */
export function dismissKeyboardAndWait(
  keyboard: DismissableKeyboard,
): Promise<void> {
  if (!keyboard.isVisible()) {
    keyboard.dismiss();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let subscription: KeyboardHideSubscription | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      subscription?.remove();
      resolve();
    };

    // Subscribe first so even an unusually quick native dismissal cannot race
    // past the continuation that opens the camera.
    subscription = keyboard.addListener("keyboardDidHide", finish);
    keyboard.dismiss();
  });
}
