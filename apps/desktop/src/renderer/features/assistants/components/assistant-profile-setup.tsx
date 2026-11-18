import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AssistantProfileDraft, AssistantProfileSetup, AssistantProfileSetupAction, AssistantWelcome } from "@mains/contracts/assistants";
import { Button, Input, Textarea } from "@/components/ui";
import { useSmoothText } from "@/features/workspace/hooks/use-smooth-text";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/cn";
import { useSetupAssistantProfileMutation } from "@/lib/redux/api/assistantsApi";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";
import { getRuntimeOS } from "../../../../shared/runtime-platform";
import { errorText } from "../lib/assistant-ui";

const bubbleLayout = "w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl px-4 py-3";
const bubble = `${bubbleLayout} bg-primary-100/80 dark:bg-primary/8`;
const sendTransition = { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
type SetupTurn = AssistantProfileSetup["turns"][number];
type SubmittedAnswer = SetupTurn & { step: number };

export function AssistantProfileSetupHistory({ setup, sending }: {
  setup: AssistantProfileSetup;
  sending?: { step: number; ref: RefObject<HTMLParagraphElement | null> };
}) {
  return setup.turns.map(({ question, answer }, index) => (
    <div key={index} className="flex flex-col gap-3">
      <p className={bubble}>{question}</p>
      <p ref={sending?.step === index ? sending.ref : undefined} className={`${bubbleLayout} origin-top-right self-end bg-mate-user-bubble`}>{answer}</p>
    </div>
  ));
}

export function AssistantProfileSetupCard({ accountId, welcome, onRetry, busy, animateIntro = false, columnRef }: {
  accountId: string; welcome: AssistantWelcome; onRetry(): Promise<void>; busy: boolean; animateIntro?: boolean;
  columnRef?: RefObject<HTMLDivElement | null>;
}) {
  const [send, request] = useSetupAssistantProfileMutation();
  const [answer, setAnswer] = useState({ step: 0, text: "" });
  const [submittedAnswer, setSubmittedAnswer] = useState<SubmittedAnswer | null>(null);
  const [edit, setEdit] = useState<AssistantProfileDraft | null>(null);
  const [failure, setFailure] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLParagraphElement>(null);
  const sendOrigin = useRef<{ columnTop: number; inputTop: number } | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const question = welcome.question;
  const setup = question?.profileSetup;
  const questionText = question?.question ?? "";
  const revealIntro = animateIntro && welcome.state === "ready" && !!setup && !setup.saved && !setup.draft && setup.turns.length === 0;
  const displayedQuestion = useSmoothText(questionText, revealIntro);
  const questionComplete = displayedQuestion === questionText;
  useLayoutEffect(() => {
    const origin = sendOrigin.current;
    sendOrigin.current = null;
    const column = columnRef?.current;
    const reply = replyRef.current;
    if (!submittedAnswer || reducedMotion || !origin || !column?.animate || !reply?.animate) return;

    // Preserve the column's position while the form becomes a message. The
    // reply also travels from the old input position within that column.
    const columnOffset = Math.max(-48, Math.min(48, origin.columnTop - column.getBoundingClientRect().top));
    const replyOffset = Math.max(-48, Math.min(48, origin.inputTop - reply.getBoundingClientRect().top - columnOffset));
    const columnAnimation = column.animate([{ transform: `translateY(${columnOffset}px)` }, { transform: "none" }], sendTransition);
    const replyAnimation = reply.animate([
      { transform: `translateY(${replyOffset}px) scale(0.97)`, opacity: 0.45 },
      { transform: "none", opacity: 1 },
    ], sendTransition);
    return () => { columnAnimation.cancel(); replyAnimation.cancel(); };
  }, [submittedAnswer, columnRef, reducedMotion]);

  if (!question || !setup) return null;
  const step = setup.turns.length;
  const answerText = answer.step === step ? answer.text : "";
  const pendingAnswer = submittedAnswer?.step === step ? submittedAnswer : null;
  const disabled = busy || request.isLoading || !!pendingAnswer;
  const platform = getRuntimeOS();
  const usesCommand = platform === "darwin";
  async function submit(input: AssistantProfileSetupAction) {
    setFailure("");
    try {
      await send({ accountId, id: welcome.assistantId, input }).unwrap();
    } catch (error) {
      if (input.action === "answer") setSubmittedAnswer(null);
      setFailure(errorText(error));
    }
  }
  function sendAnswer() {
    const text = answerText.trim();
    if (!questionComplete || !text || disabled) return;
    const column = columnRef?.current;
    const input = inputRef.current;
    sendOrigin.current = !reducedMotion && column && input
      ? { columnTop: column.getBoundingClientRect().top, inputTop: input.getBoundingClientRect().top }
      : null;
    setSubmittedAnswer({ step, question: questionText, answer: text });
    void submit({ action: "answer", step, answer: text });
  }
  const draft = edit ?? setup.draft;
  return (
    <div className="mt-5 flex flex-col gap-4 text-sm leading-relaxed text-primary-900 dark:text-primary-100">
      <AssistantProfileSetupHistory setup={pendingAnswer ? { ...setup, turns: [...setup.turns, pendingAnswer] } : setup}
        sending={submittedAnswer ? { step: submittedAnswer.step, ref: replyRef } : undefined} />
      {setup.saved ? <p className={bubble}>{question.idleMessage}</p>
        : welcome.state === "failed" ? (
          <div className="space-y-2">
            <p role="alert" className="text-danger">{welcome.error ? errorText(welcome.error) : "Could not draft the profile."}</p>
            <Button variant="subtle" disabled={disabled} onClick={() => { setFailure(""); void onRetry(); }}>Retry profile draft</Button>
          </div>
        ) : pendingAnswer || welcome.state !== "ready" || request.isLoading && !draft ? (
          <p role="status" className={cn("text-primary-600 dark:text-primary-400",
            submittedAnswer && "motion-safe:animate-[slide-fade-up_220ms_ease-out_60ms_both]")}>Preparing the profile…</p>
        ) : draft ? (
          // Start at the height of the loading line so the bottom-aligned chat moves with the card.
          <div className="grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(1lh,1fr)] overflow-clip motion-safe:transition-[grid-template-rows] motion-safe:duration-320 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:starting:grid-rows-[minmax(1lh,0fr)]">
            <form aria-label="Mate profile draft" className="glass-card w-full max-w-xl self-start space-y-4 rounded-transcript-bubble p-4 motion-safe:animate-[slide-fade-up_320ms_cubic-bezier(0.22,1,0.36,1)_both]"
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
          </div>
        ) : (
          <>
            <div className="grid">
              {/* Reserve the full question's height while revealing its text. */}
              {!questionComplete && <p className={`${bubble} pointer-events-none col-start-1 row-start-1 opacity-0 select-none`}>{questionText}</p>}
              <p aria-hidden={!questionComplete || undefined} className={cn(bubble, "col-start-1 row-start-1 self-start", !displayedQuestion && "opacity-0")}>
                {displayedQuestion}
              </p>
            </div>
            <form inert={!questionComplete} aria-hidden={!questionComplete || undefined}
              className={cn("flex flex-col items-end gap-2 transition-[opacity,translate] duration-250 ease-out motion-reduce:transition-none",
                questionComplete ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")} onSubmit={event => {
              event.preventDefault();
              sendAnswer();
            }}>
              <Textarea ref={inputRef} aria-label="Setup answer" placeholder="Describe what you’d like help with…" maxLength={24000} value={answerText}
                onKeyDown={event => {
                  const { isComposing, keyCode } = event.nativeEvent;
                  const hasModifier = usesCommand ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
                  if (event.key !== "Enter" || !hasModifier || event.altKey || event.shiftKey || isComposing || keyCode === 229 || event.defaultPrevented) return;
                  event.preventDefault();
                  if (!event.repeat) event.currentTarget.form?.requestSubmit();
                }}
                onChange={event => setAnswer({ step, text: event.target.value })} className="w-full" />
              <Button variant="submit" type="submit" disabled={disabled || !answerText.trim()}
                aria-keyshortcuts={usesCommand ? "Meta+Enter" : "Control+Enter"} className="inline-flex gap-2">
                Send
                <kbd aria-hidden="true" className="rounded-md border border-current/25 px-1.5 py-0.5 font-sans text-xxs leading-none opacity-80">
                  {keyboardShortcutLabel(usesCommand ? "Command+Enter" : "Control+Enter", platform)}
                </kbd>
              </Button>
            </form>
          </>
        )}
      {failure && <p role="alert" className="text-danger">{failure}</p>}
    </div>
  );
}
