import type { ReactNode } from "react";
import { Button, CopyButton, Text } from "@/components/ui";
import { Fork } from "@/components/ui/icons";
import { formatAbsoluteDate } from "@/lib/format-date";

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function ResponseFooter({ content, receivedAt, duration, onFork, revealOnHover = false }: {
  content: string;
  receivedAt?: Date | number;
  duration?: ReactNode;
  onFork?: () => void;
  revealOnHover?: boolean;
}) {
  const date = receivedAt === undefined ? undefined : new Date(receivedAt);
  const showTime = date !== undefined && Number.isFinite(date.getTime());
  if (!content && !showTime && !duration && !onFork) return null;

  return <Text as="div" size="s" tone="muted" className={`flex items-center gap-2 -mt-1 ${revealOnHover ? "opacity-0 pointer-events-none transition-opacity duration-150 group-hover/agent-turn:opacity-100 group-hover/agent-turn:pointer-events-auto group-focus-within/agent-turn:opacity-100 group-focus-within/agent-turn:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto motion-reduce:transition-none" : ""}`}>
    {duration}
    {content && <>
      {duration && <span className="size-0.75 rounded-full bg-current opacity-50" />}
      <CopyButton text={content} tooltip="Copy response" variant="bare"
        className="flex items-center gap-1 hover:text-primary-900 dark:hover:text-primary-100 transition-colors cursor-pointer" />
    </>}
    {onFork && <Button tooltip="Fork run from here" onClick={onFork}
      className="flex items-center gap-1 ml-0.5 hover:text-primary-900 dark:hover:text-primary-100 transition-colors cursor-pointer">
      <Fork className="size-3.5 rotate-90" />
    </Button>}
    {showTime && <Text as="span" size="xs" tone="faint" className={`ml-1 shrink-0 select-none whitespace-nowrap tabular-nums ${revealOnHover ? "" : "opacity-0 transition-opacity group-hover/agent-turn:opacity-100 group-focus-within/agent-turn:opacity-100 motion-reduce:transition-none"}`}>
      <time dateTime={date.toISOString()} title={formatAbsoluteDate(date)}>{timeFormatter.format(date)}</time>
    </Text>}
  </Text>;
}
