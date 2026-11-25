import { useState } from "react";
import type { AssistantWelcome } from "@mains/contracts/assistants";
import { Button } from "@/components/ui";
import { ToolApprovalDialog } from "@/features/workspace/components/tools/tool-approval-dialog";
import { errorText } from "../lib/assistant-ui";

export function AssistantWelcomeCard({ welcome, busy, onAnswer, onRetry }: {
  welcome: AssistantWelcome;
  busy: boolean;
  onAnswer(answer: string | null): Promise<void>;
  onRetry(): Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  if (welcome.state === "ready" && welcome.question) return <div className="mt-5 text-primary-900 dark:text-primary-100">
    <ToolApprovalDialog request={{ requestId: `welcome-${welcome.assistantId}`, runId: welcome.runId, kind: "ask_user", toolName: "AskUserQuestion",
      question: welcome.question.question, header: welcome.question.header === "Set up your assistant" ? "Set up your mate" : welcome.question.header,
      options: welcome.question.options, multiSelect: false, timestamp: new Date(welcome.createdAt).getTime() }}
      questionControls={{ value: answer, onChange: setAnswer, busy, submitLabel: "Start", dismissLabel: "Skip" }}
      onRespond={(_id, approved, value) => onAnswer(approved && value?.trim() ? value.trim() : null)} />
  </div>;
  if (welcome.state === "skipped" && welcome.question) return <div className="mt-5 space-y-5 text-sm leading-relaxed text-primary-900 dark:text-primary-100">
    <p className="w-fit max-w-full rounded-2xl bg-primary-100/80 px-4 py-3 dark:bg-primary/8">{welcome.question.question}</p>
    <p className="w-fit max-w-full rounded-2xl bg-primary-100/80 px-4 py-3 dark:bg-primary/8">{welcome.question.idleMessage}</p>
  </div>;
  if (welcome.state === "starting") return <div className="mt-5 space-y-3 text-sm text-primary-600 dark:text-primary-400">
    <p>{welcome.error ? errorText(welcome.error) : "Starting your conversation…"}</p>
    <Button variant="subtle" disabled={busy} onClick={() => void onAnswer(welcome.answer)}>Check delivery</Button>
  </div>;
  if (welcome.state === "failed") return <div className="mt-5 space-y-3 text-sm">
    <p role="alert" className="text-danger">{welcome.error ? errorText(welcome.error) : "Could not prepare the welcome."}</p>
    <Button variant="subtle" disabled={busy} onClick={() => void onRetry()}>Retry welcome</Button>
  </div>;
  return <p role="status" className="mt-5 text-sm text-primary-600 dark:text-primary-400">Preparing your welcome…</p>;
}
