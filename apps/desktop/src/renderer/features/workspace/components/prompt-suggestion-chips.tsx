import { LazyMotion, m, domAnimation, MotionConfig } from "motion/react";
import { Text } from "@/components/ui";

interface PromptSuggestionChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  disabled?: boolean;
}

export function PromptSuggestionChips({
  suggestions,
  onSelect,
  disabled,
}: PromptSuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  const suggestion = suggestions[suggestions.length - 1];

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
      <div className="w-full py-2 flex flex-col items-end gap-1">
        <m.button
          initial={{ opacity: 0, transform: "translateY(8px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          onClick={() => !disabled && onSelect(suggestion)}
          disabled={disabled}
          className="shooting-star-border group rounded-2xl max-w-[80%] text-left
            cursor-pointer
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="spark" />
          <span className="spark-backdrop rounded-2xl" />
          <Text as="span" size="sm" tone="default" className="relative z-10 flex items-start gap-2 px-4 py-2.5">
            {/* Wraps rather than truncates: a suggestion you can't read is one
                you can't judge before sending it. */}
            <span className="wrap-break-word">{suggestion}</span>
          </Text>
        </m.button>
        <m.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="text-xxs  tracking-tight text-primary-600 dark:text-primary-400 -mt-2 mr-1"
        >
        follow-up
        </m.span>
      </div>
      </MotionConfig>
    </LazyMotion>
  );
}
