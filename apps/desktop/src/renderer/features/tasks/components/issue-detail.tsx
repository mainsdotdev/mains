import { useGetSelectedResourcesQuery, type IssueWithEntity } from "@/lib/redux/api";
import { ProviderIcon } from "@/features/workspace/components/provider-icon";
import { Button, Heading2, Text } from "@/components/ui";
import { External } from "@/components/ui/icons";
import { resourceLabel } from "../lib/scope";
import { IssueBody, IssueProperties } from "./issue-properties";
import { LinearIssueDetailContent } from "./linear-issue-detail";

/**
 * Where an issue lives, by name: the linked team / repo / project / board.
 * `issues.repo` is only a fallback — for Asana and Trello it holds an opaque
 * id ("978471125127219"), never shown.
 */
function useResourceName(issue: IssueWithEntity): string | null {
  const { issue: iss, entity } = issue;
  const { data } = useGetSelectedResourcesQuery(iss.provider);
  const resource = data?.items.find((item) => item?.id === entity.resourceId);
  if (resource) return resourceLabel(resource) || null;
  return iss.repo && !/^[\da-f]{12,}$/i.test(iss.repo) ? iss.repo : null;
}

/**
 * Drawer wrapper for an issue: slim header (provider, where it lives, its
 * identifier, open-external) over the provider's detail content.
 */
export function IssueDetail({ issue }: { issue: IssueWithEntity }) {
  const { issue: iss, entity } = issue;
  const resourceName = useResourceName(issue);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1.5 px-8 py-2.5 border-b border-primary/20 dark:border-primary/10">
        <ProviderIcon provider={iss.provider} className="size-4.5 shrink-0 text-primary-800 dark:text-primary-200" />
        {resourceName && (
          <Text as="span" tone="muted" className="truncate">
            {resourceName}
          </Text>
        )}
        {iss.identifier && (
          <Text as="span" tone="subtle" className="shrink-0 tabular-nums">
            {iss.identifier}
          </Text>
        )}
        <div className="ml-auto flex items-center gap-1">
          {entity.url && (
            <Button
              variant="icon"
              onClick={() => window.api.shell.openExternal(entity.url)}
              tooltip="Open in browser"
              aria-label="Open in browser"
            >
              <External className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {iss.provider === "linear" ? <LinearIssueDetailContent issue={issue} /> : <IssueDetailContent issue={issue} />}
      </div>
    </div>
  );
}

/** Title, properties and description — every provider but Linear, which loads live detail. */
function IssueDetailContent({ issue }: { issue: IssueWithEntity }) {
  const { issue: iss, entity } = issue;
  const title = entity.title || `Issue ${iss.identifier ?? ""}`.trim();
  return (
    <div className="h-full overflow-y-auto noscrollbar">
      <div className="space-y-6 px-8 pt-8 pb-24">
        <Heading2 className="wrap-break-word">{title}</Heading2>
        <IssueProperties issue={issue} />
        <div className="border-t border-primary/20 pt-6 dark:border-primary/10">
          <IssueBody markdown={entity.body} />
        </div>
      </div>
    </div>
  );
}
