import type { PairDeviceInput, PairedDevicePlatform } from "./backend.dto";

// ─────────────────────────────────────────────────────────────
// `POST /pair` is the one unauthenticated write the backend accepts, so its
// body is allowlisted field by field rather than trusted as a shape.
// ─────────────────────────────────────────────────────────────

const PLATFORMS: ReadonlySet<PairedDevicePlatform> = new Set([
  "ios",
  "android",
  "web",
  "unknown",
]);
const MAX_DEVICE_NAME_LENGTH = 80;
const MAX_APP_VERSION_LENGTH = 40;

export function parsePairDeviceInput(input: unknown): PairDeviceInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Pairing request must be an object");
  }
  const { code, deviceName, platform, appVersion } = input as Record<
    string,
    unknown
  >;

  if (typeof code !== "string" || code.length === 0) {
    throw new Error("Pairing code is required");
  }

  const name = typeof deviceName === "string" ? deviceName.trim() : "";
  if (name.length === 0) {
    throw new Error("Device name is required");
  }

  const resolvedPlatform: PairedDevicePlatform =
    platform === undefined
      ? "unknown"
      : PLATFORMS.has(platform as PairedDevicePlatform)
        ? (platform as PairedDevicePlatform)
        : (() => {
            throw new Error("Unsupported device platform");
          })();

  if (appVersion !== undefined && typeof appVersion !== "string") {
    throw new Error("App version must be a string");
  }

  return {
    code,
    deviceName: name.slice(0, MAX_DEVICE_NAME_LENGTH),
    platform: resolvedPlatform,
    appVersion: appVersion?.slice(0, MAX_APP_VERSION_LENGTH),
  };
}
