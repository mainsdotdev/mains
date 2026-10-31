import { useToolExpansion } from "../../lib/transcript-view-state";
import { Text } from "@/components/ui";
import { Question, Check } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";

interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionItem {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionParams {
  questions?: QuestionItem[];
  question?: string;
}

interface AskUserQuestionOutput {
  questions?: QuestionItem[];
  /** Keyed by question text (Claude) or by question index (the others). */
  answers?: Record<string, string | string[]>;
  /** Claude: per-question notes, keyed by question text. */
  annotations?: Record<string, { unanswered?: unknown } | undefined>;
}

/** How Claude reports a question that ended without an answer. */
const UNANSWERED_LABELS: Record<string, string> = {
  dismissed: "Dismissed",
  skipped: "Skipped",
  replied_in_chat: "Answered in chat",
};

/** Claude joins a multi-select answer's labels with ", ". */
function pickedLabels(answer: string | string[] | undefined, multiSelect?: boolean): string[] {
  if (answer == null) return [];
  if (Array.isArray(answer)) return answer;
  return multiSelect ? answer.split(", ") : [answer];
}

export function AskUserQuestionDisplay({
  params,
  output,
  isCompact = false,
}: {
  params: AskUserQuestionParams;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useToolExpansion(false);

  const parsed = parseOutput(output);
  const fromParams = params.questions?.length
    ? params.questions
    : typeof params.question === "string" && params.question.trim()
      ? [{ question: params.question.trim() }]
      : [];
  const questions = parsed?.questions?.length
    ? parsed.questions
    : fromParams;
  const answers = parsed?.answers;
  const annotations = parsed?.annotations;
  const header =
    questions[0]?.header ??
    questions[0]?.question ??
    params.question ??
    "Question";

  const hasContent = questions.length > 0;

  return (
    <div>
      <ToolHeader
        icon={<Question className="size-4" />}
        verb="Question"
        hasDetails={hasContent}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span className={`truncate min-w-0 ${TOOL_ROW_TEXT}`}>
          {header}
        </span>
      </ToolHeader>

      {hasContent && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody as="div" className="text-xs font-sans space-y-3">
            {questions.map((q, qi) => {
              const unansweredKind = annotations?.[q.question]?.unanswered;
              const unanswered = typeof unansweredKind === "string" ? UNANSWERED_LABELS[unansweredKind] : undefined;
              // An unanswered question's answer is only the text the model read.
              const selectedAnswer = unanswered ? undefined : answers?.[q.question] ?? answers?.[String(qi)];
              const picked = pickedLabels(selectedAnswer, q.multiSelect);

              return (
                <div key={qi} className="space-y-2">
                  <Text as="div" size="inherit" tone="muted" weight="medium">
                    {q.question}
                  </Text>

                  {q.options && q.options.length > 0 && (
                    <div className="space-y-1.5">
                      {q.options.map((opt) => {
                        const isSelected = picked.includes(opt.label);

                        return (
                          <div
                            key={opt.label}
                            className={`flex items-start gap-2 rounded px-2 py-1.5 ${
                              isSelected
                                ? "bg-primary/80 dark:bg-success/10"
                                : "bg-primary-100/50 dark:bg-primary/10"
                            }`}
                          >
                            {isSelected && (
                              <Check className="size-3 mt-0.5 text-success shrink-0" />
                            )}
                            <div className="min-w-0">
                              <Text
                                as="span"
                                size="inherit"
                                weight="medium"
                                tone={isSelected ? "success" : "muted"}
                              >
                                {opt.label}
                              </Text>
                              {opt.description && (
                                <Text as="span" size="inherit" tone="faint" className="ml-1">
                                  — {opt.description}
                                </Text>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {unanswered && (
                    <Text as="div" size="inherit" tone="faint" className="px-2">
                      {unanswered}
                    </Text>
                  )}
                  {!q.options?.some((option) => picked.includes(option.label)) &&
                    selectedAnswer != null &&
                    String(selectedAnswer).trim() !== "" && (
                    <div className="flex items-start gap-2 rounded px-2 py-1.5 bg-primary/80 dark:bg-success/10">
                      <Check className="size-3 mt-0.5 text-success shrink-0" />
                      <Text as="span" size="inherit" tone="success" weight="medium" className="min-w-0 wrap-break-word">
                        {Array.isArray(selectedAnswer)
                          ? selectedAnswer.join(", ")
                          : String(selectedAnswer)}
                      </Text>
                    </div>
                  )}
                </div>
              );
            })}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}

function parseOutput(output: unknown): AskUserQuestionOutput | null {
  const parsed = coerceToolOutput(output);

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    let answers = obj.answers as
      | Record<string, string | string[]>
      | undefined;
    if (!answers) {
      const fromUserResponse = extractUserResponseAnswer(
        obj.content,
        obj.detailedContent,
      );
      if (fromUserResponse) {
        answers = { "0": fromUserResponse };
      }
    }
    return {
      questions: Array.isArray(obj.questions)
        ? (obj.questions as QuestionItem[])
        : undefined,
      answers,
      annotations: typeof obj.annotations === "object" && obj.annotations !== null
        ? (obj.annotations as AskUserQuestionOutput["annotations"])
        : undefined,
    };
  }

  return null;
}

/** Copilot / broker style: { content: "User responded: …" } */
function extractUserResponseAnswer(
  content: unknown,
  detailedContent: unknown,
): string | undefined {
  for (const field of [content, detailedContent]) {
    if (typeof field !== "string" || !field.trim()) continue;
    const m = field.match(/^User responded:\s*(.*)$/i);
    if (m) return m[1].trim();
  }
  return undefined;
}
