import type { AssistantConversation } from "@mains/contracts/assistants";
import { AsciiSpinner, Button, Text } from "@/components/ui";
import { New } from "@/components/ui/icons";
import { formatAbsoluteDate, formatCompactRelativeDate } from "@/lib/format-date";
import { errorText } from "../lib/assistant-ui";

export function AssistantChatsPanel({ chats, selectedRunId, error, disabled, onSelect, onRetry }: {
  chats?: AssistantConversation[];
  selectedRunId: string | null;
  error?: unknown;
  disabled: boolean;
  onSelect(runId: string): void;
  onRetry(): void;
}) {
  return <div className="space-y-4 pt-2">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-lg font-medium">Chats</h3>
      <Button variant="primary" className="inline-flex shrink-0 gap-2" disabled={disabled} onClick={() => onSelect("new")}><New className="size-3.5" />New task</Button>
    </div>
    <p className="text-sm leading-relaxed text-primary-600 dark:text-primary-400">Recent conversations, with the latest activity first.</p>
    {!!error && <div role="alert" className="rounded-2xl glass-card p-4">
      <p className="text-sm text-danger">{errorText(error)}</p>
      <Button variant="ghost" className="mt-2" onClick={onRetry}>Retry</Button>
    </div>}
    {!chats && !error && <div role="status" className="flex items-center gap-2 py-6 text-sm text-primary-600 dark:text-primary-400"><AsciiSpinner variant="inherit" />Loading chats…</div>}
    {chats?.length === 0 && !error && <p className="rounded-2xl glass-card px-4 py-8 text-center text-sm leading-relaxed text-primary-600 dark:text-primary-400">No conversations yet. Start a new task to begin.</p>}
    {!!chats?.length && <ul aria-label="Assistant chats" className="space-y-1 rounded-2xl glass-card p-1.5">
      {chats.map(chat => {
        const active = chat.id === selectedRunId;
        const title = chat.title?.trim() || chat.goal?.split("\n")[0].trim() || "New conversation";
        const location = chat.mode === "developer"
          ? [chat.projectName, chat.workspaceName].filter((name, index, names) => name && names.indexOf(name) === index).join(" / ") || "Repository"
          : chat.mode === "chat" ? "Chat" : "Work";
        const updatedAt = chat.updatedAt ?? chat.createdAt;
        return <li key={chat.id}>
          <Button variant="bare" fullWidth aria-current={active ? "page" : undefined} onClick={() => onSelect(chat.id)}
            className={`block min-w-0 rounded-xl px-3 py-3 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${active ? "glass-outline-soft glass-outline bg-primary/50 dark:bg-primary/5" : "hover:bg-primary/50 dark:hover:bg-primary/5"}`}>
            <Text as="span" size="s" weight="medium" className="block truncate" title={title}>{title}</Text>
            <span className="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs text-primary-600 dark:text-primary-400">
              <span className="min-w-0 truncate rounded-md bg-primary-900/5 px-1.5 py-0.5 dark:bg-primary/5" title={location}>{location}</span>
              <time className="shrink-0 tabular-nums" dateTime={new Date(updatedAt).toISOString()} title={`Last activity: ${formatAbsoluteDate(updatedAt)}`}>{formatCompactRelativeDate(updatedAt)}</time>
            </span>
          </Button>
        </li>;
      })}
    </ul>}
    {chats && chats.length >= 100 && <p className="text-xs text-primary-500">Showing the 100 most recently active chats.</p>}
  </div>;
}
