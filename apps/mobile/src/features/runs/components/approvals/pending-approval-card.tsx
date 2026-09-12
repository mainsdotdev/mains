import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import type { PendingApprovalRow } from "@/db/schema";
import { toolInputPreview } from "@/lib/format";
import { colors, radius, shadows, spacing, type, useProviderAccentPair } from "@/theme";

import { Button, SFSymbol, ThemedText } from "@/components/ui";

const VISIBLE_PARAMS_INITIAL = 4;
const APPROVAL_META_KEYS = new Set([
  "message",
  "mode",
  "requestedSchema",
  "url",
  "serverName",
  "threadId",
  "turnId",
  "elicitationId",
  "description",
  "_meta",
]);

interface ApprovalParam {
  label: string;
  value: string;
}

interface ToolApprovalDisplay {
  label: string;
  message: string;
  subtitle?: string;
  riskLevel?: "low" | "medium" | "high";
  params: ApprovalParam[];
  parsed: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatParamValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildParamEntries(input: Record<string, unknown>, meta: Record<string, unknown> | null) {
  if (meta && Array.isArray(meta.tool_params_display)) {
    const displayed = meta.tool_params_display
      .filter(isPlainObject)
      .map((param) => ({
        label:
          (typeof param.display_name === "string" && param.display_name) ||
          (typeof param.name === "string" && param.name) ||
          "",
        value: formatParamValue(param.value),
      }))
      .filter((param) => param.label);
    if (displayed.length > 0) return displayed;
  }

  if (meta && isPlainObject(meta.tool_params)) {
    return Object.entries(meta.tool_params).map(([key, value]) => ({
      label: titleCase(key),
      value: formatParamValue(value),
    }));
  }

  return Object.entries(input)
    .filter(([key]) => !APPROVAL_META_KEYS.has(key))
    .map(([key, value]) => ({ label: titleCase(key), value: formatParamValue(value) }))
    .filter((param) => param.value.length > 0);
}

/** Mobile projection of the desktop approval dialog's permission-display metadata. */
function toolApprovalDisplay(inputJson: string | null, toolName: string): ToolApprovalDisplay {
  const fallbackLabel = titleCase(toolName);
  if (!inputJson) {
    return { label: fallbackLabel, message: `Allow ${fallbackLabel}?`, params: [], parsed: true };
  }

  try {
    const parsed: unknown = JSON.parse(inputJson);
    if (!isPlainObject(parsed)) {
      return { label: fallbackLabel, message: `Allow ${fallbackLabel}?`, params: [], parsed: false };
    }

    const meta = isPlainObject(parsed._meta) ? parsed._meta : null;
    const label =
      (typeof meta?.connector_name === "string" && meta.connector_name) ||
      (typeof parsed.serverName === "string" && parsed.serverName) ||
      fallbackLabel;
    const message =
      (typeof parsed.message === "string" && parsed.message) || `Allow ${label}?`;
    const subtitle =
      (typeof meta?.subtitle === "string" && meta.subtitle) ||
      (typeof parsed.description === "string" && parsed.description) ||
      undefined;
    const normalizedRisk =
      typeof meta?.riskLevel === "string" ? meta.riskLevel.toLowerCase() : undefined;
    const riskLevel =
      normalizedRisk === "low" || normalizedRisk === "medium" || normalizedRisk === "high"
        ? normalizedRisk
        : undefined;

    return {
      label,
      message,
      subtitle,
      riskLevel,
      params: buildParamEntries(parsed, meta),
      parsed: true,
    };
  } catch {
    return { label: fallbackLabel, message: `Allow ${fallbackLabel}?`, params: [], parsed: false };
  }
}

function riskColors(level: NonNullable<ToolApprovalDisplay["riskLevel"]>) {
  switch (level) {
    case "high":
      return { foreground: colors.systemRed, background: "rgba(255, 59, 48, 0.14)" };
    case "medium":
      return { foreground: colors.systemOrange, background: "rgba(255, 149, 0, 0.14)" };
    case "low":
      return { foreground: colors.systemGreen, background: "rgba(52, 199, 89, 0.14)" };
  }
}

export function approvalKindLabel(kind: string): string {
  switch (kind) {
    case "ask_user":
      return "Question";
    case "elicitation":
      return "Input needed";
    default:
      return "Approval";
  }
}

export function formatRemaining(expiresAt: Date, now: number): string {
  const total = Math.max(0, Math.ceil((expiresAt.getTime() - now) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseOptions(json: string | null): { label: string; description?: string }[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((o): o is { label: string; description?: string } =>
          !!o && typeof o === "object" && typeof (o as { label?: unknown }).label === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/** What the card hands back; the session turns it into `runs:toolApprovalResponse`. */
export type ApprovalDecision = { approved: boolean; answer?: string };

/**
 * An agent request waiting on the user, with the answer surface the desktop's
 * dialog offers — allow/deny for a tool, options or free text for a question,
 * open-and-accept for a URL elicitation. Form elicitations (schema-driven
 * fields) stay on the Mac for now; the card can only decline them.
 */
export function PendingApprovalCard({
  approval,
  now,
  runTitle,
  providerId,
  compact = false,
  onPress,
  onRespond,
}: {
  approval: PendingApprovalRow;
  now: number;
  /** Shown on the overview so the card says which run is asking. */
  runTitle?: string | null;
  /** Codex supports granting the same approval for the rest of the run. */
  providerId?: string | null;
  compact?: boolean;
  onPress?: () => void;
  /** Absent → read-only card. */
  onRespond?: (decision: ApprovalDecision) => Promise<void>;
}) {
  const provider = useProviderAccentPair(providerId);
  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [allowForRun, setAllowForRun] = useState(false);
  const [showAllParams, setShowAllParams] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const options = parseOptions(approval.optionsJson);
  const preview = toolInputPreview(approval.toolInputJson, compact ? 70 : 160);
  const toolDisplay = toolApprovalDisplay(approval.toolInputJson, approval.toolName);
  const toolSubtitle = toolDisplay.subtitle ?? approval.description ?? undefined;
  const title =
    approval.kind === "tool_approval"
      ? toolDisplay.message
      : approval.header || approval.question || approval.toolName;
  const isForm = approval.kind === "elicitation" && approval.elicitationMode !== "url";
  const visibleParams = showAllParams
    ? toolDisplay.params
    : toolDisplay.params.slice(0, VISIBLE_PARAMS_INITIAL);
  const hiddenParamCount = Math.max(0, toolDisplay.params.length - VISIBLE_PARAMS_INITIAL);

  const respond = async (label: string, decision: ApprovalDecision) => {
    if (!onRespond || sending) return;
    setSending(label);
    setError(null);
    try {
      await onRespond(decision);
      if (process.env.EXPO_OS === "ios") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the answer");
      if (process.env.EXPO_OS === "ios") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setSending(null);
    }
  };

  const toggleOption = (label: string) => {
    setSelected((current) =>
      approval.multiSelect
        ? current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        : current.includes(label)
          ? []
          : [label],
    );
  };

  const questionAnswer =
    selected.length > 0 ? selected.join(", ") : freeText.trim().length > 0 ? freeText.trim() : null;

  const footnote = !onRespond
    ? "Answer on your Mac"
    : isForm
      ? "Fill this form in on your Mac — the phone can only decline it."
      : compact && approval.kind !== "tool_approval"
        ? "Open the run to answer"
        : "The Mac denies this if unanswered.";

  const body = (
    <View
      style={{
        backgroundColor: colors.groupedCell,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        boxShadow: shadows.card,
        padding: compact ? spacing.ms : spacing.md,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {approval.kind === "tool_approval" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 }}>
            <SFSymbol name="puzzlepiece.extension" size={15} tint={colors.secondaryLabel} />
            <ThemedText variant="subhead" numberOfLines={1} style={{ fontWeight: "600", flex: 1 }}>
              {toolDisplay.label}
            </ThemedText>
          </View>
        ) : (
          <View
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xxs + 1,
              borderRadius: radius.full,
              backgroundColor: provider.soft,
            }}
          >
            <ThemedText variant="caption" style={{ color: provider.accent, fontWeight: "600" }}>
              {approvalKindLabel(approval.kind)}
            </ThemedText>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {toolDisplay.riskLevel ? (
            <View
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xxs + 1,
                borderRadius: radius.full,
                backgroundColor: riskColors(toolDisplay.riskLevel).background,
              }}
            >
              <ThemedText
                variant="caption2"
                style={{
                  color: riskColors(toolDisplay.riskLevel).foreground,
                  fontWeight: "600",
                  textTransform: "capitalize",
                }}
              >
                {toolDisplay.riskLevel} risk
              </ThemedText>
            </View>
          ) : null}
          <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
            {formatRemaining(approval.expiresAt, now)}
          </ThemedText>
        </View>
      </View>

      {runTitle !== undefined && (
        <ThemedText variant="caption" numberOfLines={1}>
          {runTitle?.trim() || "Untitled run"}
        </ThemedText>
      )}

      <ThemedText variant="headline" numberOfLines={compact ? 2 : undefined}>
        {title}
      </ThemedText>
      {!compact && approval.kind === "tool_approval" && toolSubtitle ? (
        <ThemedText variant="subhead">{toolSubtitle}</ThemedText>
      ) : null}
      {!compact && approval.kind !== "tool_approval" && approval.header && approval.question ? (
        <ThemedText variant="callout">{approval.question}</ThemedText>
      ) : null}
      {preview && (approval.kind !== "tool_approval" || !toolDisplay.parsed) ? (
        <ThemedText variant="mono" numberOfLines={compact ? 1 : 3} selectable>
          {preview}
        </ThemedText>
      ) : null}
      {!compact && approval.kind !== "tool_approval" && approval.description ? (
        <ThemedText variant="subhead">{approval.description}</ThemedText>
      ) : null}

      {!compact && approval.kind === "tool_approval" && visibleParams.length > 0 ? (
        <View
          style={{
            backgroundColor: colors.fill,
            borderRadius: radius.md,
            borderCurve: "continuous",
            padding: spacing.ms,
            gap: spacing.sm,
          }}
        >
          {visibleParams.map((param, index) => {
            const isCommand = param.label.toLocaleLowerCase("en-US") === "command";
            return isCommand ? (
              <View
                key={`${param.label}-${index}`}
                accessible
                accessibilityLabel={`Command: ${param.value}`}
                style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}
              >
                <ThemedText
                  variant="mono"
                  style={{ color: provider.accent, fontWeight: "600" }}
                >
                  $
                </ThemedText>
                <ThemedText
                  variant="mono"
                  selectable
                  style={{ flex: 1, color: colors.label }}
                >
                  {param.value}
                </ThemedText>
              </View>
            ) : (
              <View
                key={`${param.label}-${index}`}
                style={{ flexDirection: "row", gap: spacing.ms }}
              >
                <ThemedText variant="caption" style={{ width: 88 }}>
                  {param.label}
                </ThemedText>
                <ThemedText variant="mono" selectable style={{ flex: 1, color: colors.label }}>
                  {param.value}
                </ThemedText>
              </View>
            );
          })}
          {hiddenParamCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAllParams((current) => !current)}
              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
            >
              <ThemedText variant="caption" style={{ color: provider.accent, fontWeight: "600" }}>
                {showAllParams ? "Show fewer" : `Show ${hiddenParamCount} more`}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* ── Answer surface ── */}
      {onRespond && approval.kind === "tool_approval" && (
        <View style={{ gap: spacing.sm }}>
          {providerId === "codex" ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allowForRun, disabled: sending !== null }}
              disabled={sending !== null}
              onPress={() => setAllowForRun((current) => !current)}
              style={({ pressed }) => ({
                alignSelf: "flex-start",
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                opacity: sending !== null ? 0.45 : pressed ? 0.65 : 1,
              })}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.sm / 2,
                  borderCurve: "continuous",
                  borderWidth: allowForRun ? 0 : 1.5,
                  borderColor: colors.tertiaryLabel,
                  backgroundColor: allowForRun ? provider.accent : "transparent",
                }}
              >
                {allowForRun ? (
                  <ThemedText
                    variant="caption"
                    style={{ color: colors.onTint, fontWeight: "700", lineHeight: 16 }}
                  >
                    ✓
                  </ThemedText>
                ) : null}
              </View>
              <ThemedText variant="footnote">Allow for this run</ThemedText>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm }}>
            <Button
              title="Deny"
              variant="secondary"
              size="sm"
              loading={sending === "deny"}
              disabled={sending !== null}
              onPress={() => void respond("deny", { approved: false })}
            />
            <Button
              title="Allow"
              size="sm"
              style={{ backgroundColor: provider.accent }}
              loading={sending === "allow"}
              disabled={sending !== null}
              onPress={() =>
                void respond("allow", {
                  approved: true,
                  answer: allowForRun ? "acceptForSession" : undefined,
                })
              }
            />
          </View>
        </View>
      )}

      {onRespond && approval.kind === "ask_user" && !compact && (
        <>
          {options.length > 0 && (
            <View style={{ gap: spacing.xs + 2 }}>
              {options.map((option) => {
                const active = selected.includes(option.label);
                return (
                  <Pressable
                    key={option.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    disabled={sending !== null}
                    onPress={() => toggleOption(option.label)}
                    style={({ pressed }) => ({
                      paddingHorizontal: spacing.ms,
                      paddingVertical: spacing.sm + 2,
                      borderRadius: radius.md,
                      borderCurve: "continuous",
                      backgroundColor: active ? provider.soft : colors.fill,
                      opacity: pressed ? 0.7 : 1,
                      gap: spacing.xxs,
                    })}
                  >
                    <ThemedText
                      variant="callout"
                      style={{ fontWeight: "500", color: active ? provider.accent : colors.label }}
                    >
                      {option.label}
                    </ThemedText>
                    {option.description ? (
                      <ThemedText variant="footnote">{option.description}</ThemedText>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          {(options.length === 0 || approval.isOther) && (
            <TextInput
              accessibilityLabel="Your answer"
              editable={sending === null}
              multiline
              onChangeText={setFreeText}
              placeholder={options.length > 0 ? "Or type a custom answer…" : "Type your answer…"}
              placeholderTextColor={colors.tertiaryLabel as string}
              secureTextEntry={approval.isSecret}
              style={[
                type.callout,
                {
                  minHeight: 44,
                  paddingHorizontal: spacing.ms,
                  paddingVertical: spacing.sm + 2,
                  borderRadius: radius.md,
                  borderCurve: "continuous",
                  backgroundColor: colors.fill,
                  color: colors.label,
                  textAlignVertical: "top",
                },
              ]}
              value={freeText}
            />
          )}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm }}>
            <Button
              title="Dismiss"
              variant="ghost"
              size="sm"
              loading={sending === "dismiss"}
              disabled={sending !== null}
              onPress={() => void respond("dismiss", { approved: false })}
            />
            <Button
              title="Send"
              size="sm"
              style={{ backgroundColor: provider.accent }}
              loading={sending === "send"}
              disabled={sending !== null || questionAnswer === null}
              onPress={() =>
                questionAnswer !== null &&
                void respond("send", { approved: true, answer: questionAnswer })
              }
            />
          </View>
        </>
      )}

      {onRespond && approval.kind === "elicitation" && !compact && (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm }}>
          <Button
            title="Decline"
            variant="destructive"
            size="sm"
            loading={sending === "decline"}
            disabled={sending !== null}
            onPress={() => void respond("decline", { approved: false })}
          />
          {!isForm && approval.url ? (
            <Button
              title="Open & accept"
              size="sm"
              style={{ backgroundColor: provider.accent }}
              loading={sending === "accept"}
              disabled={sending !== null}
              onPress={() => {
                void Linking.openURL(approval.url as string).catch(() => {});
                void respond("accept", { approved: true });
              }}
            />
          ) : null}
        </View>
      )}

      {error ? (
        <ThemedText variant="footnote" style={{ color: colors.systemRed }} selectable>
          {error}
        </ThemedText>
      ) : null}
      <ThemedText variant="caption2">{footnote}</ThemedText>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && { opacity: 0.85 }}
    >
      {body}
    </Pressable>
  );
}
