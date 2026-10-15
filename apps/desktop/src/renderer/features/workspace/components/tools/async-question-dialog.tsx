import { createContext, useCallback, useContext, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { asyncQuestionMessageId, readAsyncQuestionAnswer, readAsyncQuestionReply, readAsyncQuestions, readAsyncQuestionState,
  type AsyncQuestion, type AsyncQuestionAnswer, type AsyncQuestionState } from "@mains/contracts/async-questions";
import { Button, Caption, Text } from "@/components/ui";
import { Question } from "@/components/ui/icons";
import type { RunTurn } from "@/lib/redux/api/runsApi";
import type { Run, RunEvent } from "../../types";
import type { ToolApprovalRequest } from "../../hooks/use-tool-approval";
import { dismissAsyncQuestions, sendAsyncQuestionAnswers } from "../../lib/async-question-answers";
import { ToolApprovalDialog } from "./tool-approval-dialog";

interface QuestionSource {
  key: string;
  artifactId: number;
  questions: AsyncQuestion[];
  answer: AsyncQuestionAnswer | null;
  state: AsyncQuestionState;
  turnId: number | null;
  timestamp: number;
}

interface QuestionDraft {
  answers: string[];
  index: number;
  dismissed?: boolean;
  dismissError?: string;
  status: "editing" | "sending" | "unknown";
  error?: string;
  accepted?: AsyncQuestionAnswer;
}
const initialDraft = (source: QuestionSource): QuestionDraft => ({ answers: source.questions.map(() => ""), index: 0, status: "editing" });
type DialogProps = ComponentProps<typeof ToolApprovalDialog>;
interface AsyncQuestionDialogState {
  dialog: DialogProps | null;
  pending: { count: number; checking: boolean; error?: string; onOpen: () => void } | null;
  open: (artifactId: number) => void;
  canOpen: (artifactId: number) => boolean;
  answerFor: (artifactId: number) => AsyncQuestionAnswer | null;
  isSuperseded: (artifactId: number) => boolean;
  needsDeliveryCheck: (artifactId: number) => boolean;
}
const Context = createContext<AsyncQuestionDialogState | null>(null);
export function useAsyncQuestionDialog() { return useContext(Context); }

/** Question input stays outside the native tool-approval broker. */
export function AsyncQuestionDialogProvider({ ownerKey, runId, runStatus, turns, events, historical = false, children }: {
  ownerKey: string;
  runId: string | null;
  runStatus: Run["status"] | undefined;
  turns: readonly Pick<RunTurn, "id" | "status">[];
  events: readonly RunEvent[];
  historical?: boolean;
  children: ReactNode;
}) {
  const [drafts, setDrafts] = useState(() => new Map<string, QuestionDraft>());
  const [requested, setRequested] = useState<{ key: string; lifecycle: string; supersededBy?: number } | null>(null);
  const inFlight = useRef(new Set<string>());
  const activeTurnId = runStatus === "running" ? [...turns].reverse().find((turn) => turn.status === "active")?.id : undefined;
  // Explicitly opened input closes on a turn/status boundary too. Opening an
  // idle question captures that idle boundary, so it can still be answered.
  const lifecycle = `${ownerKey}/${runStatus}/${activeTurnId ?? turns.at(-1)?.id ?? ""}`;
  const latestOrdinaryInputId = useMemo(() => events.reduce((latest, event) => {
    if (event.type !== "artifact" || event.metadata?.kind !== "user-prompt" || event.metadata.isFromSubagent === true) return latest;
    const reply = readAsyncQuestionReply(event.metadata.asyncQuestionReply);
    if (reply && event.metadata.clientUserMessageId === asyncQuestionMessageId(reply.artifactId)) return latest;
    const id = Number(/^artifact-(\d+)$/.exec(event.id)?.[1]);
    return Number.isSafeInteger(id) && id > latest ? id : latest;
  }, 0), [events]);
  const sources = useMemo(() => !runId ? [] : events.flatMap((event): QuestionSource[] => {
    if (event.type !== "artifact" || event.metadata?.source !== "codex_async_questions" || event.metadata.isFromSubagent === true) return [];
    const id = /^artifact-(\d+)$/.exec(event.id)?.[1];
    const artifactId = Number(id);
    const questions = readAsyncQuestions(event.metadata.questions);
    if (!id || !Number.isSafeInteger(artifactId) || artifactId <= 0 || !questions.length) return [];
    const answer = readAsyncQuestionAnswer(event.metadata.asyncQuestionAnswer);
    const state = readAsyncQuestionState(event.metadata.asyncQuestionState);
    const turnId = event.metadata.turnId;
    return [{ key: `${ownerKey}/async-${artifactId}`, artifactId, questions,
      answer: answer?.artifactId === artifactId ? answer : null,
      state: latestOrdinaryInputId > artifactId ? { ...state, supersededBy: state.supersededBy ?? latestOrdinaryInputId } : state,
      turnId: typeof turnId === "number" && Number.isSafeInteger(turnId) && turnId > 0 ? turnId : null,
      timestamp: event.timestamp.getTime() }];
  }), [ownerKey, runId, events, latestOrdinaryInputId]);

  const updateDraft = useCallback((source: QuestionSource, update: (draft: QuestionDraft) => QuestionDraft) => {
    setDrafts((previous) => {
      const next = new Map(previous);
      const value = update(previous.get(source.key) ?? initialDraft(source));
      next.delete(source.key);
      next.set(source.key, value);
      // Keep unsent replies across chat switches without retaining transcript bodies.
      while (next.size > 64) next.delete(next.keys().next().value!);
      return next;
    });
  }, []);
  const isPending = (source: QuestionSource) => !source.answer && !drafts.get(source.key)?.accepted &&
    (!source.state.supersededBy || drafts.get(source.key)?.status === "unknown" || drafts.get(source.key)?.status === "sending");
  const pending = sources.filter(isPending);
  const current = pending.find((source) => source.key === requested?.key && requested.lifecycle === lifecycle &&
    requested.supersededBy === source.state.supersededBy && !drafts.get(source.key)?.dismissed)
    ?? (!historical && activeTurnId !== undefined ? pending.find((source) => source.turnId === activeTurnId &&
      !source.state.dismissed && !source.state.supersededBy && !drafts.get(source.key)?.dismissed) : undefined);
  const draft = current ? drafts.get(current.key) ?? initialDraft(current) : undefined;
  const index = current && draft ? Math.min(draft.index, current.questions.length - 1) : 0;

  const open = (artifactId: number) => {
    const source = sources.find((item) => item.artifactId === artifactId);
    if (!source || !isPending(source)) return;
    updateDraft(source, (previous) => ({ ...previous, dismissed: false, dismissError: undefined }));
    setRequested({ key: source.key, lifecycle, supersededBy: source.state.supersededBy });
  };

  let dialog: DialogProps | null = null;
  if (current && draft && runId) {
    const source = current;
    const requestId = `async-${runId}-${source.artifactId}-${index}`;
    const sending = draft.status === "sending";
    const unknown = draft.status === "unknown";
    const last = index === source.questions.length - 1;
    const submit = async (answer: string) => {
      if (inFlight.current.has(source.key)) return;
      const answers = draft.answers.map((value, answerIndex) => answerIndex === index ? answer.trim() : value.trim());
      inFlight.current.add(source.key);
      updateDraft(source, (previous) => ({ ...previous, answers, status: "sending", error: undefined }));
      try {
        const result = await sendAsyncQuestionAnswers({ runId, artifactId: source.artifactId, answers, checkOnly: unknown });
        updateDraft(source, (previous) => result.accepted && result.answer
          ? { ...previous, status: "editing", error: undefined, accepted: result.answer }
          : { ...previous, status: "unknown", error: "Delivery has not been confirmed yet. Check again." });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateDraft(source, (previous) => ({ ...previous, error: message,
          status: unknown || /delivery is unknown|previous answer is still being delivered/i.test(message) ? "unknown" : "editing" }));
      } finally {
        inFlight.current.delete(source.key);
      }
    };
    dialog = {
      request: { requestId, runId, toolName: "UserInput", kind: "ask_user", question: source.questions[index].title,
        header: source.questions.length > 1 ? `Question ${index + 1} of ${source.questions.length}` : undefined,
        options: source.questions[index].options?.map((label) => ({ label })), timestamp: source.timestamp },
      onRespond(id, approved, answer) {
        if (id !== requestId || sending || inFlight.current.has(source.key)) return;
        if (!approved) {
          updateDraft(source, (previous) => ({ ...previous, dismissed: true, dismissError: undefined }));
          setRequested(null);
          void dismissAsyncQuestions({ runId, artifactId: source.artifactId }).catch(() => {
            updateDraft(source, (previous) => ({ ...previous,
              dismissError: "Could not save dismissal. Reopen the questions and dismiss again to retry." }));
          });
        } else if (answer?.trim()) {
          if (!last && !unknown) {
            updateDraft(source, (previous) => previous.index !== index ? previous : ({ ...previous, index: index + 1,
              answers: previous.answers.map((value, answerIndex) => answerIndex === index ? answer.trim() : value), error: undefined }));
          } else void submit(answer);
        }
      },
      questionControls: {
        value: draft.answers[index] ?? "", busy: sending, readOnly: unknown, error: draft.error,
        submitLabel: sending ? "Sending…" : unknown ? "Check delivery" : last ? "Submit" : "Next",
        onChange(value) {
          updateDraft(source, (previous) => ({ ...previous, error: undefined,
            answers: previous.answers.map((answer, answerIndex) => answerIndex === index ? value : answer) }));
        },
        onPrevious: index > 0 && !unknown ? () => updateDraft(source, (previous) => ({ ...previous, index: index - 1, error: undefined })) : undefined,
      },
    };
  }
  const next = pending.find((source) => drafts.get(source.key)?.status === "unknown") ?? pending[0];
  return <Context.Provider value={{ dialog, open,
    pending: !historical && next ? {
      count: pending.reduce((count, source) => count + source.questions.length, 0),
      checking: drafts.get(next.key)?.status === "unknown",
      error: pending.map((source) => drafts.get(source.key)?.dismissError).find(Boolean),
      onOpen: () => open(next.artifactId),
    } : null,
    canOpen: (artifactId) => sources.some((source) => source.artifactId === artifactId && isPending(source)),
    answerFor: (artifactId) => {
      const source = sources.find((item) => item.artifactId === artifactId);
      return source ? source.answer ?? drafts.get(source.key)?.accepted ?? null : null;
    },
    isSuperseded: (artifactId) => !!sources.find((source) => source.artifactId === artifactId)?.state.supersededBy,
    needsDeliveryCheck: (artifactId) => {
      const source = sources.find((source) => source.artifactId === artifactId);
      return !!source && drafts.get(source.key)?.status === "unknown";
    },
  }}>{children}</Context.Provider>;
}

/** Real approvals take priority over the nonblocking async question dialog. */
export function RunInputDialog({ request, onRespond, variant, maxHeight, blocked = false }: {
  request?: ToolApprovalRequest;
  onRespond: DialogProps["onRespond"];
  variant?: DialogProps["variant"];
  maxHeight?: string;
  blocked?: boolean;
}) {
  const asyncQuestions = useAsyncQuestionDialog();
  if (blocked) return null;
  if (request) return <ToolApprovalDialog request={request} onRespond={onRespond} variant={variant} maxHeight={maxHeight} />;
  if (asyncQuestions?.dialog) return <ToolApprovalDialog {...asyncQuestions.dialog} variant={variant} maxHeight={maxHeight} />;
  const pending = asyncQuestions?.pending;
  if (!pending) return null;
  return <div className="px-3 py-2">
    <div className="flex items-center gap-2">
      <Question className="size-4 shrink-0 text-primary-600 dark:text-primary-400" />
      <Text size="sm" tone="muted" role="status" className="min-w-0 flex-1">
        {pending.checking ? "Answer delivery needs confirmation"
          : `${pending.count} ${pending.count === 1 ? "question awaiting an answer" : "questions awaiting answers"}`}
      </Text>
      <Button variant="ghost" aria-label={pending.checking ? "Check answer delivery" : "Answer pending questions"} onClick={pending.onOpen}>
        {pending.checking ? "Check delivery" : "Answer"}
      </Button>
    </div>
    {pending.error && <Caption role="alert" tone="danger" className="mt-1 block">{pending.error}</Caption>}
  </div>;
}
