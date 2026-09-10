import type { ConfigContext, ExpoConfig } from "expo/config";

type AppVariant = "development" | "preview" | "production";

const CAMERA_PERMISSION =
  "Mains uses the camera to scan a pairing code shown on your Mac.";

const VARIANTS: Record<
  AppVariant,
  { appName: string; identifier: string; scheme: string }
> = {
  development: {
    appName: "Mains Dev",
    identifier: "dev.mains.mobile.dev",
    scheme: "mains-dev",
  },
  preview: {
    appName: "Mains Preview",
    identifier: "dev.mains.mobile.preview",
    scheme: "mains-preview",
  },
  production: {
    appName: "Mains",
    identifier: "dev.mains.mobile",
    scheme: "mains",
  },
};

function resolveVariant(value: string | undefined): AppVariant {
  if (value === "development" || value === "preview") return value;
  return "production";
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appVariant = resolveVariant(process.env.APP_VARIANT);
  const variant = VARIANTS[appVariant];
  const allowsDevelopmentLan = appVariant !== "production";

  return {
    ...config,
    name: variant.appName,
    slug: "mains",
    owner: "okanbilal",
    version: "1.0.0",
    platforms: ["ios"],
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: variant.scheme,
    userInterfaceStyle: "dark",
    runtimeVersion: {
      policy: "fingerprint",
    },
    ios: {
      bundleIdentifier: variant.identifier,
      // Prebuild writes this into the Xcode project as DEVELOPMENT_TEAM, so a
      // cabled `expo run:ios --device` signs without opening Xcode.
      appleTeamId: "Y4MVJ7JSH6",
      supportsTablet: false,
      icon: "./assets/images/icon.png",
      infoPlist: {
        // Only TLS and WebSockets: the standard exemption, declared so
        // TestFlight stops asking about export compliance on every build.
        ITSAppUsesNonExemptEncryption: false,
        NSLocalNetworkUsageDescription:
          "Mains connects to the companion app running on your Mac.",
        NSAppTransportSecurity: allowsDevelopmentLan
          ? { NSAllowsLocalNetworking: true }
          : undefined,
      },
    },
    plugins: [
      "expo-router",
      "expo-image",
      [
        "expo-image-picker",
        {
          photosPermission:
            "Mains lets you select photos to attach to a run.",
          cameraPermission: CAMERA_PERMISSION,
          microphonePermission: false,
        },
      ],
      [
        "expo-splash-screen",
        {
          // The icon is a flat #000000 square with no alpha, and the app opens
          // on iOS's dark `systemBackground` — also pure black. Anything else
          // here draws the icon's own square as a visible tile on launch and
          // then jumps colour as the app takes over.
          backgroundColor: "#000000",
          image: "./assets/images/icon.png",
          imageWidth: 160,
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission: CAMERA_PERMISSION,
        },
      ],
      "expo-secure-store",
      "expo-sqlite",
      "./plugins/with-ios-scene-lifecycle.cjs",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      appVariant,
      eas: { projectId: "8da88a86-04be-44cc-afd4-64bbea9939bc" },
    },
  };
};
