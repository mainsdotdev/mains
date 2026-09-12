import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";

import { backendSession } from "@/backend/backend-session";
import { pairWithBackend } from "@/backend/pair-device";
import { savePairedBackend } from "@/backend/paired-backend-store";
import { Button, ThemedText } from "@/components/ui";
import {
  endpointHost,
  parsePairingLink,
  type PairedDevicePlatform,
  type PairingLink,
} from "@mains/contracts/backend";
import { startDemo } from "@/backend/demo/start";
import { goHome } from "@/features/runs";
import { colors, radius, shadows, spacing, type, useBrandColors } from "@/theme";

type ScanState =
  | { kind: "scanning" }
  | { kind: "invalid" }
  | { kind: "detected"; link: PairingLink }
  | { kind: "pairing"; link: PairingLink }
  | { kind: "failed"; link: PairingLink; message: string };

/** Camera is the normal path; manual entry covers simulators and denied camera access. */
type EntryMode = "camera" | "manual";

function devicePlatform(): PairedDevicePlatform {
  const os = process.env.EXPO_OS;
  return os === "ios" || os === "android" || os === "web" ? os : "unknown";
}

/** A pairing link that arrived as a deep link, if the app was opened by one. */
function stateFromUrl(url: string | null): ScanState {
  const link = url ? parsePairingLink(url) : null;
  return link ? { kind: "detected", link } : { kind: "scanning" };
}

export default function PairScreen() {
  const router = useRouter();
  const brand = useBrandColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanState, setScanState] = useState<ScanState>(() =>
    stateFromUrl(Linking.getLinkingURL()),
  );
  const [entryMode, setEntryMode] = useState<EntryMode>("camera");
  const [manualValue, setManualValue] = useState("");
  const [demoStarting, setDemoStarting] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const link = parsePairingLink(url);
      if (link) setScanState({ kind: "detected", link });
    });
    return () => subscription.remove();
  }, []);

  const accept = useCallback((value: string) => {
    const link = parsePairingLink(value);
    setScanState(link ? { kind: "detected", link } : { kind: "invalid" });
  }, []);

  /**
   * Read the link off the clipboard.
   *
   * `UIPasteControl` would skip iOS's "Allow Paste?" prompt, but it hands the
   * content over as item providers the system then refuses to authorize —
   * with no callback to JS, so the button simply does nothing. Reading the
   * string outright is one prompt and always works; on a screen used once,
   * that is the better trade.
   */
  const pasteLink = useCallback(async () => {
    const pasted = (await Clipboard.getStringAsync()).trim();
    if (!pasted) return;
    setManualValue(pasted);
    accept(pasted);
  }, [accept]);

  const handleScan = useCallback(
    (result: BarcodeScanningResult) => accept(result.data),
    [accept],
  );

  const pair = useCallback(
    async (link: PairingLink) => {
      setScanState({ kind: "pairing", link });
      try {
        const backend = await pairWithBackend(link, {
          deviceName: Constants.deviceName ?? "Phone",
          platform: devicePlatform(),
          appVersion: Constants.expoConfig?.version,
        });
        await savePairedBackend(backend);
        void backendSession.start();
        goHome();
      } catch (error) {
        setScanState({
          kind: "failed",
          link,
          message: error instanceof Error ? error.message : "Pairing failed",
        });
      }
    },
    [],
  );

  const reset = () => setScanState({ kind: "scanning" });
  const switchTo = (mode: EntryMode) => {
    setEntryMode(mode);
    reset();
  };

  const tryDemo = async () => {
    if (demoStarting) return;
    setDemoStarting(true);
    setDemoError(null);
    try {
      await startDemo();
      goHome();
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : "Could not start Demo Mode");
    } finally {
      setDemoStarting(false);
    }
  };

  const status = (
    <StatusPanel
      scanState={scanState}
      retryLabel={entryMode === "camera" ? "Scan again" : "Try another link"}
      onRetry={reset}
      onPair={(link) => void pair(link)}
    />
  );

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl }}
        keyboardDismissMode="on-drag"
      >
        {entryMode === "manual" ? (
          <>
            <ThemedText variant="subhead">
              On your Mac, use “Copy pairing link” next to the QR code, then paste it here.
            </ThemedText>
            <TextInput
              accessibilityLabel="Pairing link"
              autoCapitalize="none"
              autoCorrect={false}
              editable={scanState.kind !== "pairing"}
              multiline
              onChangeText={setManualValue}
              placeholder="mains://pair#code=…"
              placeholderTextColor={colors.tertiaryLabel as string}
              style={[
                type.mono,
                {
                  minHeight: 96,
                  padding: spacing.ms,
                  borderRadius: radius.md,
                  borderCurve: "continuous",
                  backgroundColor: colors.fill,
                  color: colors.label,
                  textAlignVertical: "top",
                },
              ]}
              value={manualValue}
            />
            {scanState.kind === "scanning" &&
              (manualValue.trim().length === 0 ? (
                <Button title="Paste link" onPress={() => void pasteLink()} />
              ) : (
                <Button title="Use this link" onPress={() => accept(manualValue)} />
              ))}
            {status}
            <Button title="Use the camera instead" variant="ghost" onPress={() => switchTo("camera")} />
          </>
        ) : !permission ? (
          <ThemedText variant="subhead">Opening camera…</ThemedText>
        ) : !permission.granted ? (
          <View style={{ gap: spacing.ms, paddingTop: spacing.lg }}>
            <ThemedText variant="title3">Camera access required</ThemedText>
            <ThemedText variant="subhead">
              Mains only uses the camera to read a pairing code from your desktop.
            </ThemedText>
            {permission.canAskAgain && <Button title="Allow camera" onPress={requestPermission} />}
            <Button title="Paste a link instead" variant="ghost" onPress={() => switchTo("manual")} />
          </View>
        ) : (
          <>
            <View
              style={{
                aspectRatio: 1,
                borderRadius: radius.xl,
                borderCurve: "continuous",
                overflow: "hidden",
                backgroundColor: colors.secondarySystemBackground,
                boxShadow: shadows.card,
              }}
            >
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={scanState.kind === "scanning" ? handleScan : undefined}
                style={{ flex: 1 }}
              />
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: "14%",
                  left: "14%",
                  right: "14%",
                  bottom: "14%",
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  borderWidth: 2,
                  borderColor: brand.accent,
                  opacity: 0.9,
                }}
              />
            </View>
            {status}
            {scanState.kind === "scanning" && (
              <Button title="No camera? Paste a link" variant="ghost" onPress={() => switchTo("manual")} />
            )}
          </>
        )}

        {/* App Review's way in, and anyone's: the whole app on sample data. */}
        <View style={{ gap: spacing.xs, paddingTop: spacing.lg }}>
          <ThemedText variant="footnote" style={{ color: colors.secondaryLabel, textAlign: "center" }}>
            No Mac nearby? Explore Mains with sample data.
          </ThemedText>
          <Button
            title="Try Demo Mode"
            variant="ghost"
            loading={demoStarting}
            onPress={() => void tryDemo()}
          />
          {demoError ? (
            <ThemedText
              variant="footnote"
              selectable
              style={{ color: colors.systemOrange, textAlign: "center" }}
            >
              {demoError}
            </ThemedText>
          ) : null}
        </View>
      </ScrollView>

      {process.env.EXPO_OS === "ios" && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="xmark" onPress={() => router.back()} />
        </Stack.Toolbar>
      )}
    </>
  );
}

function StatusPanel({
  scanState,
  retryLabel,
  onRetry,
  onPair,
}: {
  scanState: ScanState;
  retryLabel: string;
  onRetry: () => void;
  onPair: (link: PairingLink) => void;
}) {
  const card = {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: "continuous" as const,
    backgroundColor: colors.groupedCell,
    boxShadow: shadows.card,
    gap: spacing.sm,
  };
  switch (scanState.kind) {
    case "scanning":
      return (
        <ThemedText variant="subhead" style={{ textAlign: "center" }}>
          Align the QR code inside the frame.
        </ThemedText>
      );
    case "invalid":
      return (
        <View style={card}>
          <ThemedText variant="headline" style={{ color: colors.systemOrange }}>
            Not a Mains pairing link
          </ThemedText>
          <Button title={retryLabel} variant="secondary" size="sm" onPress={onRetry} />
        </View>
      );
    case "detected":
      return (
        <View style={card}>
          <ThemedText variant="caption" style={{ fontWeight: "600", letterSpacing: 0.6 }}>
            CODE DETECTED
          </ThemedText>
          <ThemedText variant="title3">{scanState.link.name}</ThemedText>
          <ThemedText variant="mono">
            {endpointHost(scanState.link.endpoints[0])}
            {scanState.link.endpoints.length > 1 ? ` · +${scanState.link.endpoints.length - 1} more` : ""}
          </ThemedText>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, paddingTop: spacing.xs }}>
            <Button title={retryLabel} variant="secondary" size="sm" onPress={onRetry} />
            <Button title="Pair with this Mac" size="sm" onPress={() => onPair(scanState.link)} />
          </View>
        </View>
      );
    case "pairing":
      return (
        <View style={[card, { flexDirection: "row", alignItems: "center", gap: spacing.ms }]}>
          <ActivityIndicator />
          <ThemedText variant="subhead">Pairing with {scanState.link.name}…</ThemedText>
        </View>
      );
    case "failed":
      return (
        <View style={card}>
          <ThemedText variant="headline" style={{ color: colors.systemRed }}>
            Pairing failed
          </ThemedText>
          <ThemedText variant="subhead" selectable>
            {scanState.message}
          </ThemedText>
          <Pressable onPress={onRetry}>
            <ThemedText variant="callout" style={{ color: colors.systemBlue, fontWeight: "600" }}>
              {retryLabel}
            </ThemedText>
          </Pressable>
        </View>
      );
  }
}
