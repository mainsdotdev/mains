import { useState } from "react";
import type { AssistantProfileDraft, AssistantProfileSetup, AssistantProfileSetupAction, AssistantWelcome } from "@mains/contracts/assistants";
import { Button, Input, Textarea } from "@/components/ui";
import { useSetupAssistantProfileMutation } from "@/lib/redux/api/assistantsApi";
import { errorText } from "../lib/assistant-ui";

const bubble = "w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl bg-primary-100/80 px-4 py-3 dark:bg-primary/8";

export function AssistantProfileSetupHistory({ setup }: { setup: AssistantProfileSetup }) {
  return setup.turns.map(({ question, answer }, index) => (
    <div key={index} className="flex flex-col gap-3">
      <p className={bubble}>{question}</p>
      <p className={`${bubble} self-end`}>{answer}</p>
    </div>
  ));
}

export function AssistantProfileSetupCard({ accountId, welcome, onRetry, busy }: {
  accountId: string; welcome: AssistantWelcome; onRetry(): Promise<void>; busy: boolean;
}) {
  const [send, request] = useSetupAssistantProfileMutation();
  const [answer, setAnswer] = useState("");
  const [edit, setEdit] = useState<AssistantProfileDraft | null>(null);
  const [failure, setFailure] = useState("");
  const question = welcome.question;
  const setup = question?.profileSetup;
  if (!question || !setup) return null;
  const disabled = busy || request.isLoading;
  async function submit(input: AssistantProfileSetupAction) {
    setFailure("");
    try {
      await send({ accountId, id: welcome.assistantId, input }).unwrap();
      if (input.action === "answer") setAnswer("");
    } catch (error) { setFailure(errorText(error)); }
  }
  const draft = edit ?? setup.draft;
  return (
    <div className="mt-5 flex flex-col gap-4 text-sm leading-relaxed text-primary-900 dark:text-primary-100">
      <AssistantProfileSetupHistory setup={setup} />
      {setup.saved ? <p className={bubble}>{question.idleMessage}</p>
        : welcome.state === "failed" ? (
          <div className="space-y-2">
            <p role="alert" className="text-danger">{welcome.error || "Could not draft the profile."}</p>
            <Button variant="subtle" disabled={disabled} onClick={() => { setFailure(""); void onRetry(); }}>Retry profile draft</Button>
          </div>
        ) : welcome.state !== "ready" || request.isLoading && !draft ? (
          <p role="status" className="text-primary-600 dark:text-primary-400">Preparing the profile…</p>
        ) : draft ? (
          <form aria-label="Assistant profile draft" className="glass-card w-full max-w-lg space-y-4 rounded-2xl p-4"
            onSubmit={event => { event.preventDefault(); if (!disabled) void submit({ action: "save", profile: draft }); }}>
            <h2 className="font-medium">Profile draft</h2>
            {edit ? <>
              <label className="flex flex-col gap-1.5"><span>Description</span>
                <Input required maxLength={1000} value={edit.description} onChange={event => setEdit({ ...edit, description: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5"><span>Instructions</span>
                <Textarea required maxLength={16000} value={edit.instructions} onChange={event => setEdit({ ...edit, instructions: event.target.value })} />
              </label>
            </> : <>
              <p className="whitespace-pre-wrap break-words">{draft.description}</p>
              <div className="space-y-1">
                <h3 className="text-xs text-primary-600 dark:text-primary-400">Instructions</h3>
                <p className="whitespace-pre-wrap break-words">{draft.instructions}</p>
              </div>
            </>}
            <div className="flex gap-2">
              <Button variant="submit" type="submit" disabled={disabled || !draft.description.trim() || !draft.instructions.trim()}>Save profile</Button>
              <Button variant="ghost" disabled={disabled} onClick={() => setEdit(edit ? null : draft)}>{edit ? "Discard edits" : "Edit"}</Button>
            </div>
          </form>
        ) : (
          <>
            <p className={bubble}>{question.question}</p>
            <form className="flex flex-col items-end gap-2" onSubmit={event => {
              event.preventDefault();
              if (answer.trim() && !disabled) void submit({ action: "answer", step: setup.turns.length, answer: answer.trim() });
            }}>
              <Textarea aria-label="Setup answer" placeholder="Describe what you’d like help with…" maxLength={24000} value={answer}
                onChange={event => setAnswer(event.target.value)} className="w-full" />
              <Button variant="submit" type="submit" disabled={disabled || !answer.trim()}>Send</Button>
            </form>
          </>
        )}
      {failure && <p role="alert" className="text-danger">{failure}</p>}
    </div>
  );
}
