import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { pickedQuestionOptions, type UserQuestionEntry } from "../../lib/user-question-content";

export function MateQuestionAnswer({ children }: { children: ReactNode }) {
  return <p className="ms-auto w-fit min-w-0 max-w-transcript-bubble whitespace-pre-wrap wrap-anywhere rounded-2xl bg-mate-user-bubble px-3.5 py-2 text-sm leading-relaxed">{children}</p>;
}

export function MateQuestionBubble({ entries, action }: { entries: UserQuestionEntry[]; action?: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-3 text-primary-900 dark:text-primary-100">
    {entries.map((entry, index) => {
      const { question, answer, unanswered } = entry;
      const picked = pickedQuestionOptions(entry);
      const options = answer === undefined ? question.options ?? [] : picked;
      const custom = !picked.length && answer !== undefined ? Array.isArray(answer) ? answer.join("\n") : answer : "";
      return <div key={index} className="flex min-w-0 flex-col gap-2.5">
        <section aria-label="Mate question" className={cn("min-w-0 max-w-transcript-bubble rounded-transcript-bubble bg-primary-100/80 px-4 py-3 text-sm leading-relaxed dark:bg-primary/8", options.length ? "w-full" : "w-fit")}>
          <p className="whitespace-pre-wrap wrap-anywhere font-medium">{question.question}</p>
          {!!options.length && <ol aria-label={picked.length ? "Selected options" : "Options"} className="mt-2.5 space-y-1.5">
            {options.map((option, optionIndex) => {
              const ordinal = question.options?.indexOf(option) ?? optionIndex;
              return <li key={ordinal} className={cn("flex min-w-0 gap-2.5 py-1", picked.length ? "items-center" : "items-start")}>
                <span aria-hidden="true" className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-medium",
                  picked.length ? "bg-[var(--mate-color,var(--color-primary-200))] text-black" : "mt-0.5 bg-primary-200/45 text-primary-700 dark:bg-primary/10 dark:text-primary-300")}>
                  {ordinal < 26 ? String.fromCharCode(65 + ordinal) : ordinal + 1}
                </span>
                <div className="min-w-0 wrap-anywhere">
                  <p>{option.label}</p>
                  {!picked.length && option.description && <p className="text-xs text-primary-600 dark:text-primary-400">{option.description}</p>}
                </div>
              </li>;
            })}
          </ol>}
          {unanswered && <p className="mt-1 text-xs text-primary-600 dark:text-primary-400">{unanswered}</p>}
          {index === entries.length - 1 && action && <div className="mt-2">{action}</div>}
        </section>
        {custom && <MateQuestionAnswer>{custom}</MateQuestionAnswer>}
      </div>;
    })}
  </div>;
}
