import type { AssistantConversation } from "@mains/contracts/assistants";
import { AsciiSpinner, Button, Text } from "@/components/ui";
import { formatAbsoluteDate, formatCompactRelativeDate } from "@/lib/format-date";
import { errorText } from "../lib/assistant-ui";
import { AssistantPanelEmptyState, AssistantPanelSection } from "./assistant-panel-section";

export function AssistantChatsPanel({ chats, selectedRunId, error, disabled, onSelect, onRetry }: {
  chats?: AssistantConversation[];
  selectedRunId: string | null;
  error?: unknown;
  disabled: boolean;
  onSelect(runId: string): void;
  onRetry(): void;
}) {
  return <AssistantPanelSection action={{ label: "New task", disabled, onClick: () => onSelect("new") }}>
    {!!error && <div role="alert" className="rounded-2xl glass-card p-4">
      <p className="text-sm text-danger">{errorText(error)}</p>
      <Button variant="ghost" className="mt-2" onClick={onRetry}>Retry</Button>
    </div>}
    {!chats && !error && <div role="status" className="flex items-center gap-2 py-6 text-sm text-primary-600 dark:text-primary-400"><AsciiSpinner variant="inherit" />Loading chats…</div>}
    {chats?.length === 0 && !error && <AssistantPanelEmptyState>No conversations yet. Start a new task to begin.</AssistantPanelEmptyState>}
    {!!chats?.length && <ul aria-label="Mate chats" className="space-y-0.5">
      {chats.map(chat => {
        const active = chat.id === selectedRunId;
        const title = chat.title?.trim() || chat.goal?.split("\n")[0].trim() || "New conversation";
        const updatedAt = chat.updatedAt ?? chat.createdAt;
        const elapsed = formatCompactRelativeDate(updatedAt);
        return <li key={chat.id}>
          <Button variant="bare" fullWidth aria-current={active ? "page" : undefined} onClick={() => onSelect(chat.id)}
            className={`flex min-w-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${active ? "glass-outline-soft glass-outline bg-primary/50 dark:bg-primary/5" : "hover:bg-primary/50 dark:hover:bg-primary/5"}`}>
            <Text as="span" size="s" weight="medium" className="min-w-0 truncate" title={title}>{title}</Text>
            {elapsed && <time className="shrink-0 text-xs font-normal whitespace-nowrap text-primary-500 tabular-nums"
              dateTime={new Date(updatedAt).toISOString()} title={`Last activity: ${formatAbsoluteDate(updatedAt)}`}>
              {elapsed === "now" ? "just now" : `${elapsed} ago`}
            </time>}
          </Button>
        </li>;
      })}
    </ul>}
    {chats && chats.length >= 100 && <p className="text-xs text-primary-500">Showing the 100 most recently active chats.</p>}
  </AssistantPanelSection>;
}
