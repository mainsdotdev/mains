import type { Assistant } from "@mains/contracts/assistants";
import { Text } from "@/components/ui";
import { AssistantAvatar } from "@/features/assistants/components/assistant-avatar";
import { plainActivityText } from "../lib/run-activity";
import { useAsyncQuestionDialog } from "./tools/async-question-dialog";

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
      <span aria-hidden="true" className="flex h-6 items-center gap-1">
        {[0, 1, 2].map(index => <span key={index} className="size-1.5 rounded-full bg-primary-500 motion-safe:animate-pulse"
          style={{ animationDelay: `${index * 180}ms` }} />)}
      </span>
    )}
  </div>;
}
