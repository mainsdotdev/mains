import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";

import { backendSession, useSession, type SessionSnapshot } from "@/backend/backend-session";
import type { ConnectionState } from "@/backend/connection-supervisor";
import { AsciiSpinner, Card, Row, ThemedText } from "@/components/ui";
import { ConnectionBadge } from "@/features/connection";
import { goHome } from "@/features/runs";
import { endpointHost } from "@mains/contracts/backend";
import { WS_PROTOCOL_VERSION } from "@mains/contracts/ws-protocol";
import { connectionDetail, connectionLabel, relativeTime } from "@/lib/format";
import { colors, spacing } from "@/theme";

/** How long "Copied" stays on the diagnostics row. */
const COPIED_FOR_MS = 2000;

/** Public pages can be published later without another mobile release. */
const EXTERNAL_LINKS = {
  privacy: "https://mains.dev/privacy",
  terms: "https://mains.dev/terms",
  licenses: "https://mains.dev/license",
} as const;

const SUPPORT_EMAIL = "team@mains.dev";

function openExternalLink(label: string, url: string): void {
  void Linking.openURL(url).catch(() => {
    Alert.alert(`Could not open ${label}`, `Visit ${url} in your browser.`);
  });
}

function emailSupport(): void {
  const subject = encodeURIComponent("Mains Mobile Support");
  void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}`).catch(() => {
    Alert.alert("Could not open Mail", `Email ${SUPPORT_EMAIL} for support.`);
  });
}

/** What to do about a connection that is not live — said under the status. */
function connectionHint(state: ConnectionState): string | null {
  switch (state.kind) {
    case "unreachable":
      return "Make sure Mains is open on the Mac and this phone can reach it — the same Wi‑Fi, or Tailscale on both.";
    case "authBlocked":
      return "The Mac no longer accepts this phone's pairing. Pair again from Mains › Devices on the Mac.";
    case "incompatible":
      return "One side is on an older Mains. Update the phone app or the Mac, then try again.";
    case "offline":
      return "Chats from the last sync are still here; they update once you're back online.";
    default:
      return null;
  }
}

/** States a "try again" can do something about. */
function canRetry(state: ConnectionState): boolean {
  return state.kind === "unreachable" || state.kind === "offline" || state.kind === "reconnecting";
}

/** States only a fresh pairing gets past. */
function needsPairing(state: ConnectionState): boolean {
  return state.kind === "authBlocked" || state.kind === "incompatible";
}

/** The Mac is working on it: a spinner beside the badge rather than a dead label. */
function isBusy(state: ConnectionState): boolean {
  return state.kind === "connecting" || state.kind === "reconnecting" || state.kind === "syncing";
}

/** Everything a bug report needs, as one block of text. */
function diagnostics(session: SessionSnapshot): string {
  const { backend, connection, lastSyncedAt } = session;
  const macVersion =
    connection.kind === "connected" ? connection.descriptor.appVersion : (backend?.appVersion ?? "?");
  const lines = [
    `Mains iOS ${Constants.expoConfig?.version ?? "0.0.0"} (${String(Constants.expoConfig?.extra?.appVariant ?? "production")}) · protocol ${WS_PROTOCOL_VERSION}`,
    `Phone: ${Constants.deviceName ?? "unknown"}${backend ? ` · device ${backend.deviceId}` : ""}`,
    backend
      ? `Mac: ${backend.name} · Mains ${macVersion} · protocol ${backend.protocolVersion}`
      : "Mac: not paired",
    `Connection: ${connectionLabel(connection)}${connectionDetail(connection) ? ` — ${connectionDetail(connection)}` : ""}`,
    backend ? `Endpoints: ${backend.endpoints.join(", ")}` : null,
    backend ? `Paired: ${backend.pairedAt}` : null,
    `Last synced: ${lastSyncedAt ? lastSyncedAt.toISOString() : "never"}`,
    `At: ${new Date().toISOString()}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Settings: the Mac this phone is paired with, how the two are getting on
 * right now, and the few things to do about it. Built from the same cards as
 * the sheets, in the grouped-list language of iOS Settings — the status is
 * the headline of the Mac's card, and what it calls for sits right under it.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const session = useSession();
  const { backend, connection, lastSyncedAt, refreshing } = session;
  const connected = connection.kind === "connected";

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyDiagnostics = async () => {
    const ok = await Clipboard.setStringAsync(diagnostics(session));
    if (!ok) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
  };

  const forget = () => {
    Alert.alert(
      "Forget this Mac?",
      "The pairing and everything cached from it will be removed from this phone. Revoke it on the Mac too if the phone is lost.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            void backendSession.forget().then(goHome);
          },
        },
      ],
    );
  };

  const activeEndpoint =
    connection.kind === "connected" ||
    connection.kind === "connecting" ||
    connection.kind === "reconnecting" ||
    connection.kind === "syncing"
      ? connection.endpoint
      : (backend?.endpoints[0] ?? null);
  const fallbackEndpoints = backend?.endpoints.filter((endpoint) => endpoint !== activeEndpoint) ?? [];
  const macVersion =
    connection.kind === "connected" ? connection.descriptor.appVersion : (backend?.appVersion ?? null);
  const hint = connectionHint(connection);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <View style={{ gap: spacing.sm }}>
        <ThemedText variant="title3" style={{ paddingHorizontal: spacing.xs }}>
          This Mac
        </ThemedText>
        {backend ? (
          <>
            <Card>
              {/* The status is the headline; what it calls for sits under it. */}
              <View style={{ padding: spacing.md, gap: spacing.xs }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                  <ThemedText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {backend.name}
                  </ThemedText>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    {isBusy(connection) ? <AsciiSpinner kind="circle" size={12} /> : null}
                    <ConnectionBadge state={connection} />
                  </View>
                </View>
                {connectionDetail(connection) ? (
                  <ThemedText variant="footnote" style={{ color: colors.secondaryLabel }}>
                    {connectionDetail(connection)}
                  </ThemedText>
                ) : null}
                {hint ? (
                  <ThemedText variant="footnote" style={{ color: colors.secondaryLabel, paddingTop: spacing.xxs }}>
                    {hint}
                  </ThemedText>
                ) : null}
              </View>
              <Row
                first={false}
                title="Address"
                subtitle={
                  fallbackEndpoints.length > 0
                    ? `Also ${fallbackEndpoints.map(endpointHost).join(", ")}`
                    : undefined
                }
                value={activeEndpoint ? endpointHost(activeEndpoint) : "—"}
              />
              <Row first={false} title="Mains on the Mac" value={macVersion ?? "—"} />
              <Row
                first={false}
                title="Paired"
                value={relativeTime(new Date(backend.pairedAt))}
                subtitle={new Date(backend.pairedAt).toLocaleString()}
              />
              <Row
                first={false}
                title="Last synced"
                value={lastSyncedAt ? relativeTime(lastSyncedAt) : "Not yet"}
                subtitle={lastSyncedAt ? lastSyncedAt.toLocaleString() : undefined}
              />
            </Card>

            <Card>
              <Row
                first
                title={refreshing ? "Syncing…" : "Sync now"}
                subtitle={connected ? "Pull the latest runs, workspaces and settings" : "Available once the Mac is live"}
                disabled={!connected || refreshing}
                trailing={refreshing ? <AsciiSpinner kind="square" size={12} /> : undefined}
                onPress={() => void backendSession.refresh().catch(() => {})}
              />
              {canRetry(connection) ? (
                <Row
                  first={false}
                  title="Try again"
                  subtitle="Reconnect to the Mac now rather than on the next timer"
                  onPress={() => backendSession.retry()}
                />
              ) : null}
              {needsPairing(connection) ? (
                <Row
                  first={false}
                  title="Pair again"
                  subtitle="Scan a new pairing code from the Mac"
                  chevron="chevron.right"
                  onPress={() => router.push("/pair" as Href)}
                />
              ) : null}
              <Row
                first={false}
                title="Copy diagnostics"
                subtitle="Versions, addresses and the connection's state, for a bug report"
                value={copied ? "Copied" : undefined}
                onPress={() => void copyDiagnostics()}
              />
            </Card>
          </>
        ) : (
          <Card>
            <View style={{ padding: spacing.md, gap: spacing.xs }}>
              <ThemedText variant="headline">No Mac paired</ThemedText>
              <ThemedText variant="footnote" style={{ color: colors.secondaryLabel }}>
                Open Mains on the desktop, turn on network access or Tailscale HTTPS, and scan its pairing code.
              </ThemedText>
            </View>
            <Row
              first={false}
              title="Scan pairing code"
              chevron="chevron.right"
              onPress={() => router.push("/pair" as Href)}
            />
          </Card>
        )}
      </View>

      <View style={{ gap: spacing.sm }}>
        <ThemedText variant="title3" style={{ paddingHorizontal: spacing.xs }}>
          This phone
        </ThemedText>
        <Card>
          <Row first title="Name" value={Constants.deviceName ?? "—"} />
          {backend ? (
            <Row
              first={false}
              title="Device ID"
              subtitle="As listed under Devices on the Mac"
              value={backend.deviceId.slice(0, 8)}
            />
          ) : null}
          <Row first={false} title="Version" value={Constants.expoConfig?.version ?? "0.0.0"} />
          <Row
            first={false}
            title="Build"
            value={String(Constants.expoConfig?.extra?.appVariant ?? "production")}
          />
          <Row first={false} title="Protocol" value={String(WS_PROTOCOL_VERSION)} />
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <ThemedText variant="title3" style={{ paddingHorizontal: spacing.xs }}>
          Legal &amp; Support
        </ThemedText>
        <Card>
          <Row
            first
            title="AI Data Sharing"
            subtitle="Review or reset provider permissions"
            chevron="chevron.right"
            onPress={() => router.push("/ai-data-sharing" as Href)}
          />
          <Row
            first={false}
            title="Privacy Policy"
            subtitle="How Mains handles your data"
            chevron="arrow.up.right.square"
            onPress={() => openExternalLink("Privacy Policy", EXTERNAL_LINKS.privacy)}
          />
          <Row
            first={false}
            title="Terms of Use"
            subtitle="Terms for using Mains"
            chevron="arrow.up.right.square"
            onPress={() => openExternalLink("Terms of Use", EXTERNAL_LINKS.terms)}
          />
          <Row
            first={false}
            title="Support"
            subtitle={`Email ${SUPPORT_EMAIL}`}
            chevron="envelope"
            onPress={emailSupport}
          />
          <Row
            first={false}
            title="Open Source Licenses"
            subtitle="Open-source software used by the app"
            chevron="arrow.up.right.square"
            onPress={() => openExternalLink("Open Source Licenses", EXTERNAL_LINKS.licenses)}
          />
        </Card>
      </View>

      {backend ? (
        <Card>
          <Row first title="Forget this Mac" tone="destructive" onPress={forget} />
        </Card>
      ) : null}
    </ScrollView>
  );
}
