import { cn } from "@/lib/cn";
import { getProviderVariant, type ProviderVariant } from "@/lib/provider-variants";
import { chatLabel } from "@/components/layout/sidebar/chat-item";
import { useGetRunByIdQuery } from "@/lib/redux/api";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { ChatActionsMenu } from "./chat-actions-menu";
import { BaseTab } from "./base-tab";

export function ChatHeader({ runId, variant }: { runId: string; variant: ProviderVariant }) {
  // currentData clears on a chat switch and follows title updates from either
  // the generated title or the chat's Rename action.
  const { currentData: run } = useGetRunByIdQuery(runId);
  const title = run ? chatLabel(run) : "";
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
        trailingAction={<ChatActionsMenu aboveBrowser={browserOpen} />}
      />
    </div>
  );
}
