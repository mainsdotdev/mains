import { useToolExpansion } from "../../lib/transcript-view-state";
import { Text } from "@/components/ui";
import { Question, Check } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { pickedQuestionOptions, readUserQuestionEntries, type AskUserQuestionParams } from "../../lib/user-question-content";

export type { AskUserQuestionParams } from "../../lib/user-question-content";

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

  const entries = readUserQuestionEntries(params, output);
  const first = entries[0]?.question;
  const header =
    first?.header ??
    first?.question ??
    params.question ??
    "Question";

  const hasContent = entries.length > 0;

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
            {entries.map((entry, qi) => {
              const { question: q, answer: selectedAnswer, unanswered } = entry;
              const picked = pickedQuestionOptions(entry);

              return (
                <div key={qi} className="space-y-2">
                  <Text as="div" size="inherit" tone="muted" weight="medium">
                    {q.question}
                  </Text>

                  {q.options && q.options.length > 0 && (
                    <div className="space-y-1.5">
                      {q.options.map((opt) => {
                        const isSelected = picked.includes(opt);

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
                  {!picked.length &&
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
