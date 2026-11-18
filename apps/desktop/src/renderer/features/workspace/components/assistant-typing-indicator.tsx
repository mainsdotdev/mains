import type { Assistant } from "@mains/contracts/assistants";
import { SquareCell, squareCellStyle, Text } from "@/components/ui";
import { AssistantAvatar } from "@/features/assistants/components/assistant-avatar";
import { plainActivityText } from "../lib/run-activity";
import { useAsyncQuestionDialog } from "./tools/async-question-dialog";

// The center row of the square spinner yields two evenly spaced horizontal passes.
const WAITING_CELL_STYLES = [0, 1, 2].map(column => squareCellStyle(1, column, 3));

export function AssistantTypingIndicator({ assistant, thinkingText, awaitingInput = false }: {
  assistant?: Pick<Assistant, "id" | "name" | "avatar">;
  thinkingText?: string;
  awaitingInput?: boolean;
}) {
  const questions = useAsyncQuestionDialog();
  if (awaitingInput || questions?.dialog) return null;
  const activity = thinkingText && plainActivityText(thinkingText);
  return <div role="status" aria-label={`${assistant?.name ?? "Mate"} is responding`} className="flex min-w-0 items-center gap-2.5">
    {assistant && <AssistantAvatar avatar={assistant.avatar} seed={assistant.id} className="size-6" />}
    {activity ? (
      <Text as="span" size="sm" tone="inherit" className="shine-text min-w-0 max-w-120 truncate">{activity}</Text>
    ) : (
      <span aria-hidden="true" className="flex h-6 items-center gap-1 text-primary-600 [--tsq-base:color-mix(in_srgb,currentColor_30%,transparent)] motion-reduce:[--tsq-base:currentColor] dark:text-primary-300">
        {WAITING_CELL_STYLES.map((style, index) => <SquareCell key={index} style={style}
          className="size-1.5 motion-reduce:before:animate-none! motion-reduce:after:animate-none!" />)}
      </span>
    )}
  </div>;
}
