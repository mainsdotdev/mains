import { eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Alert, ScrollView, View } from "react-native";

import { useSession } from "@/backend/backend-session";
import { Card, Row, ThemedText } from "@/components/ui";
import { db } from "@/db/client";
import { aiDataConsents } from "@/db/schema";
import {
  AI_DATA_DISCLOSURE_VERSION,
  AI_PROVIDER_DISCLOSURES,
  revokeAiDataConsent,
  revokeAllAiDataConsents,
} from "@/lib/ai-data-consent";
import { colors, spacing } from "@/theme";

/** Review and revoke the provider permissions stored on this phone. */
export default function AiDataSharingScreen() {
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const consentQuery = useLiveQuery(
    db.select().from(aiDataConsents).where(eq(aiDataConsents.backendId, backendId)),
    [backendId],
  );

  const byProvider = new Map(consentQuery.data.map((consent) => [consent.providerId, consent]));

  const revoke = (providerId: string, serviceName: string) => {
    Alert.alert(
      `Revoke ${serviceName} permission?`,
      `Mains will ask again before this Mac sends data to ${serviceName}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => revokeAiDataConsent(backendId, providerId),
        },
      ],
    );
  };

  const resetAll = () => {
    Alert.alert(
      "Reset all AI permissions?",
      "Mains will ask again before this Mac sends data to any AI provider.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => revokeAllAiDataConsents(backendId),
        },
      ],
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <ThemedText variant="subhead" selectable style={{ color: colors.secondaryLabel }}>
        Before your Mac sends a request to a third-party AI service, Mains asks
        for permission for that Mac and provider. Switching providers asks
        again. These choices are stored only on this phone.
      </ThemedText>

      {backendId ? (
        <View style={{ gap: spacing.sm }}>
          <ThemedText variant="title3" style={{ paddingHorizontal: spacing.xs }}>
            This Mac
          </ThemedText>
          <Card>
            {AI_PROVIDER_DISCLOSURES.map((disclosure, index) => {
              const consent = byProvider.get(disclosure.providerId);
              const allowed =
                consent?.disclosureVersion === AI_DATA_DISCLOSURE_VERSION;
              const accepted = allowed
                ? `Allowed ${consent.acceptedAt.toLocaleDateString()}`
                : "Ask before sending";
              return (
                <Row
                  key={disclosure.providerId}
                  first={index === 0}
                  title={disclosure.serviceName}
                  subtitle={
                    allowed
                      ? `${disclosure.recipientName} · Tap to revoke`
                      : disclosure.recipientName
                  }
                  value={accepted}
                  onPress={
                    allowed
                      ? () => revoke(disclosure.providerId, disclosure.serviceName)
                      : undefined
                  }
                />
              );
            })}
          </Card>
        </View>
      ) : (
        <Card>
          <View style={{ padding: spacing.md, gap: spacing.xs }}>
            <ThemedText variant="headline">No Mac paired</ThemedText>
            <ThemedText variant="footnote" style={{ color: colors.secondaryLabel }}>
              Provider permissions appear here after you pair this phone with a Mac.
            </ThemedText>
          </View>
        </Card>
      )}

      {backendId && consentQuery.data.length > 0 ? (
        <Card>
          <Row first title="Reset all permissions" tone="destructive" onPress={resetAll} />
        </Card>
      ) : null}
    </ScrollView>
  );
}
