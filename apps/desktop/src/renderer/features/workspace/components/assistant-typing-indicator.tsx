import { isAssistantRobotShape, type Assistant } from "@mains/contracts/assistants";
import { Text } from "@/components/ui";
import { AssistantAvatar } from "@/features/assistants/components/assistant-avatar";
import { AssistantRobotPreview } from "@/features/assistants/components/assistant-robot-avatar";
import { cn } from "@/lib/cn";
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
    <Text as="span" size="sm" tone={activity ? "inherit" : "secondary"} className={cn("min-w-0 max-w-120 truncate", activity && "shine-text")}>
      {activity || "Thinking"}
    </Text>
  </div>;
}
