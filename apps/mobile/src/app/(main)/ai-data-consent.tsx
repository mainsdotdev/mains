import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import {
  Button,
  Card,
  Row,
  SheetHeader,
  SheetHint,
  ThemedText,
  sheetContentStyle,
} from "@/components/ui";
import { useAiDataConsent } from "@/features/ai-data-consent";
import { colors, spacing, useBrandColors, useProviderAccent } from "@/theme";

const MAINS_PRIVACY_URL = "https://mains.dev/privacy";

function openPolicy(label: string, url: string): void {
  void Linking.openURL(url).catch(() => {
    Alert.alert(`Could not open ${label}`, `Visit ${url} in your browser.`);
  });
}

/** The explicit third-party AI permission shown before any provider receives data. */
export default function AiDataConsentSheet() {
  const router = useRouter();
  const { pending, allowPending, declinePending } = useAiDataConsent();
  const [error, setError] = useState<string | null>(null);
  const brand = useBrandColors();
  const providerAccent = useProviderAccent(pending?.disclosure.providerId);

  // A swipe-down or system back is a refusal too. Explicit allow/decline clears
  // the pending request first, so this cleanup becomes a harmless no-op there.
  useEffect(() => () => declinePending(), [declinePending]);

  if (!pending) return null;
  const { disclosure, isDemo } = pending;

  const allow = () => {
    setError(null);
    try {
      allowPending();
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save permission");
    }
  };

  const decline = () => {
    declinePending();
    router.back();
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[sheetContentStyle, { paddingBottom: spacing.sm }]}
      >
        <SheetHeader title={isDemo ? "Demo data sharing" : "AI data sharing"} />

        <View style={{ gap: spacing.xs, paddingHorizontal: spacing.sm }}>
          <ThemedText variant="title2" style={{ textAlign: "center" }}>
            {isDemo
              ? `Continue the demo with ${disclosure.serviceName}?`
              : `Share data with ${disclosure.recipientName}?`}
          </ThemedText>
          <ThemedText
            variant="subhead"
            selectable
            style={{ color: colors.secondaryLabel, textAlign: "center" }}
          >
            {isDemo
              ? "This run uses bundled sample data. Nothing is sent to your Mac or a third-party AI service."
              : "Your Mac will share the following with this third-party AI service to complete your request."}
          </ThemedText>
        </View>

        <Card>
          <Row first title="Your message and chat history" />
          <Row first={false} title="Skills and instructions you attach" />
          <Row first={false} title="Files and tool results the agent uses" />
        </Card>

        <ThemedText
          variant="subhead"
          selectable
          style={{ color: colors.secondaryLabel, paddingHorizontal: spacing.sm }}
        >
          {isDemo
            ? "Demo Mode stays on this phone. Review these policies before using a connected Mac."
            : `${disclosure.recipientDetail} Mains sends nothing until you choose Allow & Send.`}
        </ThemedText>

        <View style={{ alignItems: "flex-start", gap: spacing.xs, paddingHorizontal: spacing.sm }}>
          <Pressable
            accessibilityRole="link"
            hitSlop={6}
            onPress={() => openPolicy(`${disclosure.serviceName} Privacy`, disclosure.privacyPolicyUrl)}
            style={({ pressed }) => ({ paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 })}
          >
            <ThemedText variant="subhead" style={{ color: brand.accent, fontWeight: "600" }}>
              {disclosure.serviceName} Privacy
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            hitSlop={6}
            onPress={() => openPolicy("Mains Privacy", MAINS_PRIVACY_URL)}
            style={({ pressed }) => ({ paddingVertical: spacing.xxs, opacity: pressed ? 0.6 : 1 })}
          >
            <ThemedText variant="subhead" style={{ color: brand.accent, fontWeight: "600" }}>
              Mains Privacy
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
          paddingBottom: spacing.lg,
          gap: spacing.sm,
        }}
      >
        <SheetHint text={error} />
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button title="Not Now" variant="secondary" style={{ flex: 1 }} onPress={decline} />
          <Button
            title={isDemo ? "Continue Demo" : "Allow & Send"}
            style={{ flex: 1.4, backgroundColor: providerAccent }}
            onPress={allow}
          />
        </View>
      </View>
    </View>
  );
}
