import { Button } from "@/components/ui";
import { MicrophoneToggle } from "@/components/ui/icons";

export function VoiceMuteButton({ muted, disabled, onToggle }: {
  muted: boolean;
  disabled: boolean;
  onToggle(): void;
}) {
  const label = muted ? "Unmute microphone" : "Mute microphone";
  return (
    <Button variant="icon" type="button" aria-label={label} aria-pressed={muted} tooltip={label}
      disabled={disabled} onClick={onToggle}
      className="mr-1">
      <MicrophoneToggle muted={muted} className="size-4.5" aria-hidden="true" />
    </Button>
  );
}
