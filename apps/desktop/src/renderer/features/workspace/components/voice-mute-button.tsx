import { Button } from "@/components/ui";
import { MicrophoneToggle } from "@/components/ui/icons";

export function VoiceMuteButton({ muted, disabled, onToggle, className = "" }: {
  muted: boolean;
  disabled: boolean;
  onToggle(): void;
  className?: string;
}) {
  const label = muted ? "Unmute microphone" : "Mute microphone";
  return (
    <Button variant="icon" type="button" aria-label={label} aria-pressed={muted} tooltip={label}
      disabled={disabled} onClick={onToggle}
      className={`mr-1 ${className}`}>
      <MicrophoneToggle muted={muted} className="size-4.5" aria-hidden="true" />
    </Button>
  );
}
