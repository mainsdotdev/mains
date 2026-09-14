import { Button } from "../button";
import { Microphone } from "../icons";

interface DictationButtonProps {
  isRecording: boolean;
  onToggle: () => void;
}

export function DictationButton({
  isRecording,
  onToggle,
}: DictationButtonProps) {
  const buttonClass = `p-1.5 mr-2 rounded-full transition-all duration-200 ${
    isRecording ? "bg-primary-300 dark:bg-primary-700/50 animate-pulse" : "hover:bg-primary-200/30 dark:hover:bg-primary/20"
  }`;

  return (
    <Button
      tooltip="Open dictation"
      type="button"
      onClick={onToggle}
      className={buttonClass}
      aria-label={isRecording ? "Stop recording" : "Start voice input"}
      title={isRecording ? "Stop recording" : "Voice input"}
    >
      <Microphone className="dark:text-primary-400 text-primary-600" isRecording={isRecording} />
    </Button>
  );
}
