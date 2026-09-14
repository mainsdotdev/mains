import { useEffect, useState } from "react";
import { AsciiSpinner, Text } from "@/components/ui";
import { useModeConfig } from "@/hooks/use-mode-config";
import type { ModeId } from "../../../../shared/modes";

export { AsciiSpinner };

/**
 * What the agent is said to be doing while a turn runs, per experience.
 *
 * The words are the only thing on screen between turns, so they set the tone as
 * much as the prompt delta does: Developer talks about the work as engineering,
 * Work talks about it as knowledge work — the same rule that keeps the mode's
 * instructions from naming commands — and Chat sounds like someone thinking
 * rather than a machine processing.
 */
const LOADER_WORDS: Record<ModeId, readonly string[]> = {
  developer: [
    "Thinking",
    "Analyzing",
    "Searching",
    "Processing",
    "Generating",
    "Creating",
    "Evaluating",
    "Researching",
    "Refining",
    "Formulating",
  ],
  work: [
    "Working",
    "Reading",
    "Gathering",
    "Drafting",
    "Organizing",
    "Reviewing",
    "Summarizing",
    "Preparing",
    "Checking",
    "Pulling it together",
  ],
  chat: [
    "Thinking",
    "Reading",
    "Considering",
    "Looking into it",
    "Thinking it over",
    "Working it out",
    "Checking",
  ],
};

function pickWord(words: readonly string[]): string {
  return words[Math.floor(Math.random() * words.length)];
}

/** Strip markdown formatting for plain-text display */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")  // **bold**
    .replace(/\*(.+?)\*/g, "$1")       // *italic*
    .replace(/__(.+?)__/g, "$1")       // __bold__
    .replace(/_(.+?)_/g, "$1")         // _italic_
    .replace(/`(.+?)`/g, "$1")         // `code`
    .replace(/^#+\s*/gm, "");          // # headings
}

export function AsciiLoader({
  className,
  thinkingText,
}: {
  className?: string;
  variant?: "claude" | "copilot" | "codex" | "cursor";
  thinkingText?: string;
}) {
  const { mode } = useModeConfig();
  const words = LOADER_WORDS[mode];
  const [word, setWord] = useState(() => pickWord(words));

  useEffect(() => {
    const wordInterval = setInterval(() => setWord(pickWord(words)), 4000);
    return () => clearInterval(wordInterval);
  }, [words]);

  return (
    <div className={`flex items-center gap-2 ${className || ""}`}>

      <Text as="span" size="sm" tone="inherit" className="shine-text truncate max-w-120">
        {thinkingText ? stripMarkdown(thinkingText) : word}
      </Text>
    </div>
  );
}
