import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { SFSymbol, ThemedText } from "@/components/ui";
import { isDesktopOnlyOutput } from "@/lib/output-presentation";
import { colors, radius, spacing } from "@/theme";

export function outputSize(size: number): string {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function DesktopOutputNotice({ name }: { name: string }) {
  return <View accessible accessibilityLabel={`${name}. See on desktop`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.ms, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.fill }}>
    <SFSymbol name="desktopcomputer" size={24} tint={colors.secondaryLabel} />
    <View style={{ flex: 1, gap: spacing.xxs }}>
      <ThemedText variant="callout" numberOfLines={2} style={{ fontWeight: "600" }}>{name}</ThemedText>
      <ThemedText variant="caption">See on desktop</ThemedText>
    </View>
  </View>;
}

export function OutputFileCard({ runId, artifactId, name, byteSize, saved = false, desktopOnly = false }: {
  runId: string; artifactId: number; name: string; byteSize?: number; saved?: boolean; desktopOnly?: boolean;
}) {
  const router = useRouter();
  if (desktopOnly || isDesktopOnlyOutput({ name })) return <DesktopOutputNotice name={name} />;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${name}${saved ? ", available offline" : ""}`}
    onPress={() => router.push({ pathname: "/output/[artifactId]", params: { runId, artifactId: String(artifactId) } } as Href)}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.ms, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.fill, opacity: pressed ? 0.7 : 1 })}>
    <SFSymbol name="doc.text" size={24} tint={colors.secondaryLabel} />
    <View style={{ flex: 1, gap: spacing.xxs }}>
      <ThemedText variant="callout" numberOfLines={2} style={{ color: colors.label, fontWeight: "600" }}>{name}</ThemedText>
      <ThemedText variant="caption">{name.split(".").pop()?.toUpperCase()}{byteSize !== undefined ? ` · ${outputSize(byteSize)}` : ""}{saved ? " · Available offline" : ""}</ThemedText>
    </View>
    <SFSymbol name={saved ? "checkmark.circle" : "chevron.right"} size={15} tint={colors.tertiaryLabel} />
  </Pressable>;
}
