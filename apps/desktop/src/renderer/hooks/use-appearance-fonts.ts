import { useLayoutEffect } from "react";
import { useAppSelector } from "@/lib/redux/hooks";
import { readPersistedAppSetting } from "@/lib/redux/persist-boot";
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  applyAppearanceFontSizes,
  isFontSize,
} from "@/lib/appearance-fonts";

/**
 * Mirrors the persisted font sizes from the `appSettings` slice onto `:root`.
 *
 * Like the theme, these have to land before the first paint — rehydration is
 * async, and the interface size rescales the whole layout, so waiting for the
 * store would resize the app in front of the user at every launch. The module
 * therefore seeds itself with one synchronous read of the persisted values,
 * then follows redux for the rest of the session.
 */

if (typeof window !== "undefined") {
  // Pre-paint seed. Whatever redux rehydrates a tick later agrees with this in
  // every case except a corrupt blob, where the hook below corrects it.
  applyAppearanceFontSizes(document.documentElement, {
    interfaceFontSize: readPersistedAppSetting(
      "interfaceFontSize",
      isFontSize,
      DEFAULT_INTERFACE_FONT_SIZE,
    ),
    codeFontSize: readPersistedAppSetting(
      "codeFontSize",
      isFontSize,
      DEFAULT_CODE_FONT_SIZE,
    ),
  });
}

export function useAppearanceFonts() {
  const interfaceFontSize = useAppSelector((s) => s.appSettings.interfaceFontSize);
  const codeFontSize = useAppSelector((s) => s.appSettings.codeFontSize);

  useLayoutEffect(() => {
    applyAppearanceFontSizes(document.documentElement, {
      interfaceFontSize,
      codeFontSize,
    });
  }, [interfaceFontSize, codeFontSize]);
}
