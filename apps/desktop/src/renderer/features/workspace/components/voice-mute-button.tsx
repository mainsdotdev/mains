import { Button } from "@/components/ui";
import { MicrophoneToggle } from "@/components/ui/icons";

export function VoiceMuteButton({ muted, disabled, onToggle }: {
  muted: boolean;
  disabled: boolean;
  onToggle(): void;
}) {
  const label = muted ? "Unmute microphone" : "Mute microphone";
  return (
    <Button type="button" aria-label={label} aria-pressed={muted} tooltip={label}
      disabled={disabled} onClick={onToggle}
      className="mr-1 rounded-full p-1 text-primary-600 hover:bg-primary-200/40 dark:text-primary-400 dark:hover:bg-primary-800">
      <MicrophoneToggle muted={muted} className="size-4.5" aria-hidden="true" />
    </Button>
  );
}
