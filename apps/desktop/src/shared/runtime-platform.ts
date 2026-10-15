/** The OS of this desktop client, independent of the selected backend host. */
export function getRuntimeOS(): string {
  const globals = globalThis as typeof globalThis & {
    window?: { api?: { platform?: { os?: string } } };
    navigator?: { platform?: string };
  };
  const desktopOS = globals.window?.api?.platform?.os;
  if (desktopOS) return desktopOS;
  if (typeof process !== "undefined" && process.platform) return process.platform;
  const browserPlatform = globals.navigator?.platform ?? "";
  if (/Mac|iPhone|iPad/i.test(browserPlatform)) return "darwin";
  if (/Win/i.test(browserPlatform)) return "win32";
  return "linux";
}
