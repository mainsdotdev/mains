import type { RealtimeVoiceCatalog } from "@mains/contracts/realtime";
import type { CodexAdapterConfig } from "../../../../shared/adapter.types";
import { Button, Select, Text } from "@/components/ui";
import { Play, Stop } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useVoicePreview } from "../hooks/use-voice-preview";
import { voicePreviewUrl } from "../lib/codex-voice-previews";
import { VoiceOrb } from "../../workspace/components/voice-orb";
import { VOICE_ORB_COLORS, voiceOrbColorStyle } from "../../workspace/lib/voice-orb-colors";
import { VOICE_ORB_STYLES, resolveVoiceOrbStyle } from "../../workspace/lib/voice-orb-styles";
import { SettingsDivider, SettingsRow, SettingsSection } from "./settings-layout";

const voiceLabel = (voice: string) => voice.charAt(0).toUpperCase() + voice.slice(1);

export function CodexVoiceSettings({ config, catalog, loading, error, updating, onUpdate, onRetry }: {
  config: CodexAdapterConfig;
  catalog?: RealtimeVoiceCatalog | null;
  loading: boolean;
  error?: unknown;
  updating: boolean;
  onUpdate(patch: Partial<CodexAdapterConfig>): Promise<boolean>;
  onRetry(): void;
}) {
  const color = config.voiceOrbColor ?? "theme";
  const orbStyle = resolveVoiceOrbStyle(config.voiceOrbStyle);
  const voice = config.realtimeVoice || catalog?.defaultVoice || "";
  const supported = !!catalog?.voices.includes(voice);
  const choices = catalog?.voices.map((id) => ({ value: id, label: voiceLabel(id) })) ?? [];
  const preview = useVoicePreview();

  return (
    <SettingsSection title="Voice">
      <div className="flex flex-col items-center gap-4 py-6">
        <VoiceOrb active getAudioLevels={preview.getAudioLevels} color={color} orbStyle={orbStyle} className="size-36 sm:size-44" />
        <Text as="span" size="lg" weight="medium">
          {voice ? voiceLabel(voice) : "Voice conversation"}
        </Text>
        <div className="flex flex-col items-center gap-2">
          <Button
            className="flex gap-2 text-xs px-2.5 py-2 rounded-2xl glass-card text-primary-800 dark:text-primary-200 min-w-32"
            disabled={!preview.playingVoice && (!supported || !voicePreviewUrl(voice))}
            aria-label={preview.playingVoice ? "Stop voice preview" : `Preview ${voiceLabel(voice)} voice`}
            onClick={() => { if (preview.playingVoice) preview.stop(); else preview.play(voice); }}
          >
            {preview.playingVoice ? <Stop className="size-4" /> : <Play className="size-4" />}
            {preview.playingVoice ? "Stop preview" : "Preview voice"}
          </Button>
          <Text as="span" size="xs" tone="warning" role="status" className="min-h-4 text-center">
            {preview.error}
          </Text>
        </div>
      </div>
      <SettingsDivider />
      <SettingsRow title="Voice" description="Changes apply to your next voice conversation.">
        <Select
          aria-label="Voice"
          value={voice}
          options={choices}
          placeholder={loading ? "Loading voices…" : voice && !supported ? `${voiceLabel(voice)} (unavailable)` : "Voices unavailable"}
          disabled={updating || loading || !catalog?.voices.length || !!error}
          onChange={(realtimeVoice) => {
            preview.play(realtimeVoice);
            void onUpdate({ realtimeVoice }).then((saved) => { if (!saved) preview.stop(); });
          }}
        />
      </SettingsRow>
      {!!error && (
        <div className="flex items-center justify-between gap-3 pb-3" role="status">
          <Text size="xs" tone="muted">Unable to load Codex voices.</Text>
          <Button variant="secondary" onClick={onRetry}>Retry</Button>
        </div>
      )}
      {catalog && voice && !supported && !error && (
        <Text size="xs" tone="warning" className="pb-3">
          Choose an available voice before starting your next conversation.
        </Text>
      )}
      <SettingsDivider />
      <SettingsRow title="Orb style" description="Soft clouds, a textured sphere, or luminous aurora ribbons.">
        <Select aria-label="Orb style" value={orbStyle}
          options={VOICE_ORB_STYLES}
          disabled={updating}
          onChange={(value) => { void onUpdate({ voiceOrbStyle: resolveVoiceOrbStyle(value) }); }} />
      </SettingsRow>
      <SettingsDivider />
      <SettingsRow title="Orb color" description={orbStyle === "cloud" ? "Follow your app theme or choose a color." : "Follow your app theme or choose a color blend."}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Orb color">
          {VOICE_ORB_COLORS.map((choice) => (
            <Button
              key={choice.value}
              type="button"
              variant="ghost"
              aria-label={`${choice.label} orb color`}
              aria-pressed={color === choice.value}
              tooltip={choice.label}
              disabled={updating}
              onClick={() => { void onUpdate({ voiceOrbColor: choice.value }); }}
              className={cn("size-9 rounded-full p-1 ring-1 ring-inset ring-primary-300/50 dark:ring-primary-700/70 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
                color === choice.value && "ring-2 ring-accent")}
            >
              <span aria-hidden="true" data-orb-style={orbStyle}
                className="voice-orb relative block size-full overflow-hidden rounded-full" style={voiceOrbColorStyle(choice.value)} />
            </Button>
          ))}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
