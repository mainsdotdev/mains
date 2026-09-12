import { useRouter } from "expo-router";
import { Pressable, Switch, View, type ViewStyle } from "react-native";

import { colors, radius, shadows, spacing, useBrandColors } from "@/theme";

import { SFSymbol } from "./sf-symbol";
import { ThemedText } from "./themed-text";

/**
 * The furniture of a settings sheet — the model and run options sheets are
 * built from these: a header with a close button, grouped cards, rows that
 * pick, unfold or switch, and a line for the Mac's refusal.
 */

/** Content padding for a sheet's ScrollView. */
export const sheetContentStyle: ViewStyle = {
  padding: spacing.md,
  paddingTop: spacing.ms,
  gap: spacing.md,
  paddingBottom: spacing.xxl,
};

export function SheetHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => router.back()}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.fill,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <SFSymbol name="xmark" size={17} tint={colors.label} />
      </Pressable>
      <ThemedText variant="headline">{title}</ThemedText>
      <View style={{ width: 40 }} />
    </View>
  );
}

/** A grouped-list section caption, above its card. */
export function SectionTitle({ children }: { children: string }) {
  return (
    <ThemedText
      variant="footnote"
      style={{ color: colors.secondaryLabel, marginLeft: spacing.md, marginBottom: -spacing.sm }}
    >
      {children.toUpperCase()}
    </ThemedText>
  );
}

/** The Mac's refusal, under the cards; nothing when there is none. */
export function SheetHint({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <ThemedText variant="footnote" selectable style={{ textAlign: "center", color: colors.systemOrange }}>
      {text}
    </ThemedText>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const brand = useBrandColors();
  return <Switch value={value} onValueChange={onChange} trackColor={{ true: brand.accent }} />;
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: colors.groupedCell,
        boxShadow: shadows.card,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  value,
  chevron,
  trailing,
  selected = false,
  indented = false,
  disabled = false,
  tone = "default",
  first,
  onPress,
}: {
  title: string;
  subtitle?: string;
  /** Trailing text (a row's current choice). */
  value?: string;
  /** Trailing SF Symbol (a row's disclosure). */
  chevron?: string;
  /** Trailing control (a switch); the row itself is then not pressable. */
  trailing?: React.ReactNode;
  selected?: boolean;
  indented?: boolean;
  disabled?: boolean;
  /** `destructive` sets the title in red — a row that removes something. */
  tone?: "default" | "destructive";
  first: boolean;
  onPress?: () => void;
}) {
  const brand = useBrandColors();
  return (
    <View>
      {!first && <View style={{ height: 1, marginLeft: spacing.md, backgroundColor: colors.separator }} />}
      <Pressable
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityState={{ selected, disabled }}
        disabled={disabled || !onPress}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.ms,
          paddingLeft: indented ? spacing.lg : spacing.md,
          paddingRight: spacing.md,
          paddingVertical: subtitle ? spacing.sm + 2 : spacing.ms + 2,
          backgroundColor: pressed && onPress ? colors.fill : "transparent",
          opacity: disabled ? 0.5 : 1,
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <ThemedText
            variant="body"
            numberOfLines={1}
            style={tone === "destructive" ? { color: colors.systemRed } : undefined}
          >
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText variant="footnote" numberOfLines={2} style={{ color: colors.secondaryLabel }}>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        {value ? (
          <ThemedText variant="body" numberOfLines={1} style={{ color: colors.secondaryLabel, maxWidth: "45%" }}>
            {value}
          </ThemedText>
        ) : null}
        {chevron ? <SFSymbol name={chevron} size={13} tint={colors.tertiaryLabel} /> : null}
        {selected && <SFSymbol name="checkmark" size={16} tint={brand.accent} />}
        {trailing}
      </Pressable>
    </View>
  );
}
