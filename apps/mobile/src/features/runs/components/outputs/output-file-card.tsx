import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { SFSymbol, ThemedText } from "@/components/ui";
import { isDesktopOnlyOutput } from "@/lib/output-presentation";
import { colors, radius, spacing } from "@/theme";

export function outputSize(size: number): string {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function DesktopOutputNotice({ name }: { name: string }) {
  return <View accessible accessibilityLabel={`${name}. See on desktop`} style={styles.card}>
    <SFSymbol name="desktopcomputer" size={20} tint={colors.secondaryLabel} />
    <View style={styles.text}>
      <ThemedText variant="callout" numberOfLines={1} ellipsizeMode="middle" style={{ fontWeight: "600" }}>{name}</ThemedText>
      <ThemedText variant="caption" numberOfLines={1}>See on desktop</ThemedText>
    </View>
  </View>;
}

export function OutputFileCard({ runId, artifactId, name, byteSize, saved = false, desktopOnly = false }: {
  runId: string; artifactId: number; name: string; byteSize?: number; saved?: boolean; desktopOnly?: boolean;
}) {
  const router = useRouter();
  return <RunFileCard name={name} byteSize={byteSize} saved={saved} desktopOnly={desktopOnly} onPress={() => router.push({ pathname: "/output/[artifactId]", params: { runId, artifactId: String(artifactId) } } as Href)} />;
}

export function RunFileCard({ name, byteSize, saved = false, desktopOnly = false, status, onPress }: {
  name: string; byteSize?: number; saved?: boolean; desktopOnly?: boolean; status?: string; onPress?: () => void;
}) {
  if (desktopOnly || isDesktopOnlyOutput({ name })) return <DesktopOutputNotice name={name} />;
  return <Pressable accessibilityRole={onPress ? "button" : "text"} accessibilityLabel={`${onPress ? "Open " : ""}${name}${status ? `, ${status}` : saved ? ", available offline" : ""}`} disabled={!onPress}
    onPress={onPress}
    style={({ pressed }) => [styles.card, { opacity: pressed ? 0.7 : 1 }]}>
    <SFSymbol name="doc.text" size={20} tint={colors.secondaryLabel} />
    <View style={styles.text}>
      <ThemedText variant="callout" numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.label, fontWeight: "600" }}>{name}</ThemedText>
      <ThemedText variant="caption" numberOfLines={1}>{name.split(".").pop()?.toUpperCase()}{byteSize !== undefined ? ` · ${outputSize(byteSize)}` : ""}{status ? ` · ${status}` : saved ? " · Available offline" : ""}</ThemedText>
    </View>
    {onPress ? <SFSymbol name={saved ? "checkmark.circle" : "chevron.right"} size={15} tint={colors.tertiaryLabel} /> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.ms, paddingVertical: spacing.sm, minHeight: 48,
    borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.fill,
  },
  text: { flex: 1, minWidth: 0, gap: spacing.xxs },
});
