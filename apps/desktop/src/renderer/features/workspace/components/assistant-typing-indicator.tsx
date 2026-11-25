import { isAssistantRobotShape, type Assistant } from "@mains/contracts/assistants";
import { Text } from "@/components/ui";
import { AssistantAvatar } from "@/features/assistants/components/assistant-avatar";
import { AssistantRobotPreview } from "@/features/assistants/components/assistant-robot-avatar";
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
  const shape = assistant?.avatar.shape;
  return <div role="status" aria-label={`${assistant?.name ?? "Mate"} is responding`} className="flex min-w-0 items-center gap-2.5">
    {isAssistantRobotShape(shape)
      ? <AssistantRobotPreview shape={shape} state="thinking" presentation="status" className="size-8" />
      : assistant && <AssistantAvatar avatar={assistant.avatar} seed={assistant.id} working className="size-8" />}
    <Text as="span" size="sm" tone="subtle"
      className="min-w-0 max-w-120 truncate shine-text [--shine-text-base:var(--color-primary-600)] dark:[--shine-text-base:var(--color-primary-400)]">
      {activity || "Thinking"}
    </Text>
  </div>;
}
