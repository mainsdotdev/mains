import { useMemo, useState } from "react";
import { Pressable, Switch, TextInput, View } from "react-native";
import {
  buildElicitationContent,
  getElicitationDefaultValues,
  type ElicitationValues,
} from "@mains/contracts/mcp-elicitation";

import { Button, SFSymbol, ThemedText } from "@/components/ui";
import { parseApprovalForm } from "@/lib/elicitation";
import { useThemeColors, radius, spacing, type, useProviderAccentPair } from "@/theme";

import type { ApprovalDecision } from "./pending-approval-card";

/** Mounted per request: defaults and answers never outlive their approval card. */
export function ElicitationForm({ schemaJson, providerId, sending, onRespond }: {
  schemaJson: string | null;
  providerId?: string | null;
  sending: string | null;
  onRespond: (action: string, decision: ApprovalDecision) => Promise<void>;
}) {
  const colors = useThemeColors();
  const provider = useProviderAccentPair(providerId);
  const { fields, unsupported } = useMemo(() => parseApprovalForm(schemaJson), [schemaJson]);
  const [values, setValues] = useState<ElicitationValues>(() => getElicitationDefaultValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const busy = sending !== null;

  const change = (name: string, value: string | boolean | string[]) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors({});
  };

  const submit = () => {
    if (busy || unsupported.length > 0) return;
    const result = buildElicitationContent(fields, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    void onRespond("submit", { approved: true, answer: JSON.stringify(result.content) });
  };

  return (
    <View style={{ gap: spacing.md }}>
      {fields.map((field) => {
        const value = Object.prototype.hasOwnProperty.call(values, field.name) ? values[field.name] : undefined;
        const error = Object.prototype.hasOwnProperty.call(errors, field.name) ? errors[field.name] : undefined;
        const label = `${field.label}${field.required ? " (required)" : ""}`;
        return (
          <View key={field.name} style={{ gap: spacing.xs }}>
            <ThemedText variant="callout" style={{ fontWeight: "600" }}>{label}</ThemedText>
            {field.description ? <ThemedText variant="footnote">{field.description}</ThemedText> : null}
            {field.type === "boolean" ? (
              <Switch
                accessibilityLabel={label}
                disabled={busy}
                value={value === true}
                onValueChange={(next) => change(field.name, next)}
                trackColor={{ true: provider.accent }}
              />
            ) : field.type === "enum" || field.type === "multiEnum" ? (
              <View style={{ gap: spacing.xs }}>
                {(field.enumValues ?? []).map((option, index) => {
                  const selected = field.type === "multiEnum"
                    ? Array.isArray(value) && value.includes(option) : value === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole={field.type === "multiEnum" ? "checkbox" : "radio"}
                      accessibilityLabel={`${field.label}: ${field.enumLabels?.[index] ?? option}`}
                      accessibilityState={{ checked: selected, disabled: busy }}
                      disabled={busy}
                      onPress={() => {
                        const picked = Array.isArray(value) ? value : [];
                        change(field.name, field.type === "multiEnum"
                          ? selected ? picked.filter((entry) => entry !== option) : [...picked, option]
                          : selected ? "" : option);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: "row", alignItems: "center", gap: spacing.sm,
                        minHeight: 44, paddingHorizontal: spacing.ms, paddingVertical: spacing.sm,
                        borderRadius: radius.md, borderCurve: "continuous",
                        backgroundColor: selected ? provider.soft : colors.fill,
                        opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                      })}
                    >
                      <ThemedText variant="callout" style={{ flex: 1, color: selected ? provider.accent : colors.label }}>
                        {field.enumLabels?.[index] ?? option}
                      </ThemedText>
                      {selected ? <SFSymbol name="checkmark" size={14} tint={provider.accent} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <TextInput
                accessibilityLabel={label}
                accessibilityHint={error ?? field.description}
                editable={!busy}
                secureTextEntry={field.isSecret}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={field.isSecret ? "default" : field.type === "number" ? "numbers-and-punctuation" : field.format === "email" ? "email-address" : field.format === "uri" ? "url" : "default"}
                placeholder={field.format === "date" ? "YYYY-MM-DD" : undefined}
                placeholderTextColor={colors.tertiaryLabel as string}
                value={typeof value === "string" ? value : ""}
                onChangeText={(next) => change(field.name, next)}
                style={[type.callout, {
                  minHeight: 44, paddingHorizontal: spacing.ms, paddingVertical: spacing.sm,
                  borderRadius: radius.md, borderCurve: "continuous",
                  backgroundColor: colors.fill, color: colors.label,
                }]}
              />
            )}
            {error ? <ThemedText accessibilityRole="alert" variant="footnote" style={{ color: colors.systemRed }}>{error}</ThemedText> : null}
          </View>
        );
      })}
      {unsupported.length > 0 ? (
        <ThemedText accessibilityRole="alert" variant="footnote" style={{ color: colors.systemRed }}>
          This form contains unsupported fields: {unsupported.join(", ")}. Complete it in Mains on your computer.
        </ThemedText>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm }}>
        <Button title="Cancel" variant="ghost" size="sm" disabled={busy} loading={sending === "cancel"}
          onPress={() => void onRespond("cancel", { approved: false, answer: "cancel" })} />
        <Button title="Decline" variant="secondary" size="sm" disabled={busy} loading={sending === "decline"}
          onPress={() => void onRespond("decline", { approved: false })} />
        <Button title="Submit" size="sm" disabled={busy || unsupported.length > 0} loading={sending === "submit"}
          style={{ backgroundColor: provider.accent }} onPress={submit} />
      </View>
    </View>
  );
}
