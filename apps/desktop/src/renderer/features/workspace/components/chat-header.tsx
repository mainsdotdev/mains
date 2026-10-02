import { cn } from "@/lib/cn";
import { getProviderVariant, type ProviderVariant } from "@/lib/provider-variants";
import { chatLabel } from "@/components/layout/sidebar/chat-item";
import { useGetRunByIdQuery } from "@/lib/redux/api";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { ChatActionsMenu } from "./chat-actions-menu";
import { BaseTab } from "./base-tab";

export function ChatHeader({ runId, variant, fallbackRun }: {
  runId: string;
  variant: ProviderVariant;
  fallbackRun?: { id: string; title?: string | null; goal: string | null };
}) {
  // currentData clears on a chat switch and follows title updates from either
  // the generated title or the chat's Rename action.
  const { currentData } = useGetRunByIdQuery(runId);
  // Sidebar navigation already loaded this run. Use that title until its
  // individual query is ready, without carrying over the previous chat's title.
  const run = currentData ?? (fallbackRun?.id === runId ? fallbackRun : undefined);
  const title = run ? chatLabel({ title: run.title ?? null, goal: run.goal }) : "";
  const { isOpen: browserOpen, isExpanded, toggleExpanded } = useBrowserPanel();
  const { icon: Icon, accentClassName } = getProviderVariant(variant);

  return (
    <div
      role="tablist"
      aria-label="Chat tabs"
      className="relative z-(--z-panel-toggle) hidden h-(--shell-header-height) min-w-0 items-end md:flex"
    >
      <BaseTab
        isActive={!isExpanded}
        isFirst
        role="tab"
        ariaLabel={title || "Untitled chat"}
        onClick={() => { if (isExpanded) toggleExpanded(); }}
        icon={<Icon className={cn("size-4", accentClassName)} />}
        label={title}
        tooltip={title}
        trailingAction={<ChatActionsMenu key={runId} aboveBrowser={browserOpen} />}
      />
    </div>
  );
}
