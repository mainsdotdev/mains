import type { IssueWithEntity } from "@/lib/redux/api";
import { IssueTabContent } from "@/features/workspace/components/issue-tab-content";
import { ProviderIcon } from "@/features/workspace/components/provider-icon";
import { Button, Text } from "@/components/ui";
import { External } from "@/components/ui/icons";
import { LinearIssueDetailContent } from "./linear-issue-detail";

/**
 * Drawer wrapper for an issue: slim header (provider, number, open-external)
 * over the existing IssueTabContent renderer.
 */
export function IssueDetail({ issue }: { issue: IssueWithEntity }) {
  const { issue: iss, entity } = issue;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1.5 px-8 py-2.5 border-b border-primary/20 dark:border-primary/10">
        <ProviderIcon provider={iss.provider} className="size-4.5 shrink-0 text-primary-800 dark:text-primary-200" />
        <Text as="span" tone="muted" className="truncate">
          {iss.repo ?? ""}
        </Text>
        {iss.number != null && (
          <Text as="span" tone="subtle">
            #{iss.number}
          </Text>
        )}
        <div className="ml-auto flex items-center gap-1">
          {entity.url && (
            <Button
              onClick={() => window.api.shell.openExternal(entity.url)}
              tooltip="Open in browser"
              className="p-1.5 rounded-lg hover:bg-primary/20 dark:hover:bg-primary/10"
            >
              <External className="w-3.5 h-3.5 text-primary-700 dark:text-primary-300" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {iss.provider === "linear" ? (
          <LinearIssueDetailContent issue={issue} />
        ) : (
          <IssueTabContent issue={issue} />
        )}
      </div>
    </div>
  );
}
