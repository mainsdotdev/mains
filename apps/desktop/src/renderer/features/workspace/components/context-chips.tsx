import { useComposerContext } from "@/features/workspace/hooks/use-composer-context";
import { Close } from "@/components/ui/icons";
import { ProviderIcon } from "./provider-icon";
import { Button } from "@/components/ui";

/**
 * The chip row above the composer. Reads its own context rather than taking it
 * as props: it renders exactly what is attached, so threading four lists and
 * three removers through the input only gave them a chance to disagree.
 *
 * Browser selections are visual attachments; skills and code selections render
 * as inline chips inside the prompt itself. This row only owns issue/signal
 * chips.
 */
export function ContextChips() {
  const { issues, signals, remove } = useComposerContext();

  // Only what this row actually draws may open it. Skills are context too, but
  // they appear as chips *inside* the input (`skillChipMap` on RichInputForm),
  // so counting them here opened an empty padded band above the composer.
  const hasContext = issues.length > 0 || signals.length > 0;

  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${hasContext ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
    >
      <div className="overflow-hidden min-h-0">
        <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
          {issues.map((issue) => (
            <div
              key={issue.entityId}
              className={`flex items-center glass-button gap-1.5 px-2 py-1.5 rounded-full text-xs  dark:text-primary-300 text-primary-700`}
            >
              <ProviderIcon
                provider={issue.provider}
                className="size-4"
                fallback="text"
              />
              <span className="truncate max-w-37.5">{issue.title}</span>
              <Button
                onClick={() => remove(issue)}
                className=" flex items-center glass-button justify-center rounded-full p-0.5  transition-colors"
                title="Remove from context"
              >
                <Close className="size-3" />
              </Button>
            </div>
          ))}

          {signals.map((signal) => (
            <div
              key={signal.entityId}
              className={`flex items-center glass-button gap-1.5 px-2 py-1.5 rounded-full text-xs dark:text-primary-300 text-primary-700`}
            >
              <ProviderIcon
                provider={signal.source}
                className="w-3 h-3"
                fallback="text"
              />
              <span className="truncate max-w-37.5">{signal.title}</span>
              <Button
                onClick={() => remove(signal)}
                className="w-4 h-4 flex items-center justify-center glass-button rounded-full p-0.5 transition-colors"
                title="Remove from context"
              >
                <Close className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
