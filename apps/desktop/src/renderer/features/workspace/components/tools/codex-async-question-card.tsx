import type { AsyncQuestion, AsyncQuestionAnswer, AsyncQuestionState } from "@mains/contracts/async-questions";
import { Button, Text } from "@/components/ui";
import { AskUserQuestionDisplay } from "./ask-user-question-display";
import { useAsyncQuestionDialog } from "./async-question-dialog";
import { MateQuestionBubble } from "./mate-question-bubble";

/** The transcript retains the question and reply. The open card takes the composer slot. */
export function CodexAsyncQuestionCard({ artifactId, questions, answer, state, bubble = false }: {
  runId: string;
  artifactId: number;
  questions: AsyncQuestion[];
  answer?: AsyncQuestionAnswer | null;
  state?: AsyncQuestionState;
  bubble?: boolean;
}) {
  const dialog = useAsyncQuestionDialog();
  const accepted = answer ?? dialog?.answerFor(artifactId);
  const superseded = state?.supersededBy || dialog?.isSuperseded(artifactId);
  const checking = dialog?.needsDeliveryCheck(artifactId);
  const items = questions.map(({ title, options }) => ({ question: title, options: options?.map(label => ({ label })) }));
  const answerButton = dialog?.canOpen(artifactId) && <Button variant="ghost" className="mt-1 text-xs"
    aria-label={checking ? "Check question answer delivery" : undefined} onClick={() => dialog.open(artifactId)}>
    {checking ? "Check delivery" : "Answer"}
  </Button>;
  if (bubble) {
    const action = !accepted && (!superseded || checking) && dialog?.activeArtifactId !== artifactId ? answerButton : undefined;
    return <MateQuestionBubble entries={items.map((question, index) => ({
      question, answer: accepted?.answers[index],
      unanswered: !accepted && superseded && !checking ? "No longer awaiting an answer" : undefined,
    }))} action={action} />;
  }
  return <div>
    <AskUserQuestionDisplay params={{ questions: items }}
      output={accepted ? { answers: Object.fromEntries(accepted.answers.map((value, index) => [String(index), value])) } : undefined} />
    {accepted ? <Text as="p" size="xs" tone="success" role="status" className="mt-1">Answer sent</Text>
      : superseded && !checking ? <Text as="p" size="xs" tone="muted" className="mt-1">No longer awaiting an answer</Text>
      : answerButton}
  </div>;
}
