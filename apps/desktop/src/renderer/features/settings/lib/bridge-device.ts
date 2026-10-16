import type { BridgeRegisteredBackend } from "@mains/contracts/bridge-auth";

export type BridgeDeviceKind = "desktop" | "laptop" | "phone" | "tablet" | "browser";

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  macos: "macOS",
  win32: "Windows",
  windows: "Windows",
  linux: "Linux",
  ios: "iOS",
  ipados: "iPadOS",
  android: "Android",
  web: "Browser",
};

const ACCESS_LABELS: Record<BridgeRegisteredBackend["status"], string> = {
  approved: "Approved",
  pending: "Waiting for approval",
  revoked: "Access revoked",
};

export function bridgeDevicePresentation(device: BridgeRegisteredBackend) {
  const platform = device.platform.trim().toLowerCase();
  let kind: BridgeDeviceKind = "desktop";
  // Bridge currently stores the OS, not hardware details. Use a laptop icon
  // only for an explicit model/name hint; other computers keep a generic icon.
  if (platform === "web") kind = "browser";
  else if (platform === "ipados" || (platform === "ios" && /ipad/i.test(device.label))) kind = "tablet";
  else if (platform === "ios" || platform === "android") kind = "phone";
  else if (/macbook|laptop|notebook|thinkpad|surface book/i.test(device.label)) kind = "laptop";

  const seen = device.lastSeen ? new Date(device.lastSeen) : null;
  const lastSeen = seen && Number.isFinite(seen.getTime())
    ? `Last seen ${seen.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : null;

  return {
    kind,
    platform: kind === "tablet" && platform === "ios" ? "iPadOS" : PLATFORM_LABELS[platform] ?? "Unknown platform",
    access: ACCESS_LABELS[device.status],
    lastSeen,
  };
}
