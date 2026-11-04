import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { IssueStatus } from "@mains/contracts/issue-status";
import { markdownComponents } from "@/components/markdown-components";
import { Caption, Text } from "@/components/ui";
import { useGetIssueStatusesQuery, type IssueWithEntity } from "@/lib/redux/api";
import { labelColor, parseLabels } from "@/lib/label-colors";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { supportsStatusMapping } from "../lib/scope";
import { formatIssueDate, GroupIcon, Pill, plainHex, PRIORITY_NAMES, PriorityIcon } from "./issue-row";
import { IssueStatusIcon } from "./issue-status";

const EMPTY_STATUSES: IssueStatus[] = [];

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Text as="dt" size="xs" tone="subtle" className="pt-1">
        {label}
      </Text>
      <dd className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</dd>
    </>
  );
}

/**
 * The issue's fields as a Linear-style property list — the same normalized
 * `issues` columns the row draws, plus what the row leaves out (assignee,
 * due date). Rows a provider has no value for are left out.
 */
export function IssueProperties({ issue }: { issue: IssueWithEntity }) {
  const { issue: iss, entity } = issue;
  const { data: statuses = EMPTY_STATUSES } = useGetIssueStatusesQuery();
  const status = statuses.find((candidate) => candidate.id === iss.statusId) ?? null;
  const labels = parseLabels(iss.labels);
  const due = formatIssueDate(iss.dueAt);
  const created = formatIssueDate(entity.occurredAt);
  const avatar = proxiedImageSrc(iss.assigneeAvatarUrl);
  // The provider's own state, where it has a workflow of its own and the
  // name says more than the status ("In review · Ready for QA").
  const providerState =
    supportsStatusMapping(iss.provider) && iss.state && iss.state.toLowerCase() !== status?.name.toLowerCase()
      ? iss.state
      : null;

  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-2.5">
      {status && (
        <Property label="Status">
          <IssueStatusIcon status={status} />
          <Text as="span" size="s">
            {status.name}
          </Text>
          {providerState && (
            <Text as="span" size="s" tone="subtle">
              · {providerState}
            </Text>
          )}
        </Property>
      )}
      {iss.priority > 0 && (
        <Property label="Priority">
          <PriorityIcon priority={iss.priority} decorative />
          <Text as="span" size="s">
            {PRIORITY_NAMES[iss.priority]}
          </Text>
        </Property>
      )}
      {iss.assignee && (
        <Property label="Assignee">
          {avatar && <img src={avatar} alt="" className="size-4 shrink-0 rounded-full" />}
          <Text as="span" size="s" className="truncate">
            {iss.assignee}
          </Text>
        </Property>
      )}
      {labels.length > 0 && (
        <Property label="Labels">
          {labels.map((label) => (
            <Pill key={label} color={labelColor(label)}>
              {label}
            </Pill>
          ))}
        </Property>
      )}
      {iss.groupName && (
        <Property label="Project">
          <Pill icon={<GroupIcon color={plainHex(iss.groupColor)} />}>{iss.groupName}</Pill>
        </Property>
      )}
      {due && (
        <Property label="Due">
          <Text as="span" size="s">
            {due}
          </Text>
        </Property>
      )}
      {created && (
        <Property label="Created">
          <Text as="span" size="s" tone="secondary">
            {created}
          </Text>
        </Property>
      )}
    </dl>
  );
}

/** The issue's description as Markdown, or a note when there is none. */
export function IssueBody({ markdown }: { markdown: string | null | undefined }) {
  if (!markdown) return <Caption>No description.</Caption>;
  return (
    <Text
      as="div"
      size="s"
      tone="secondary"
      className="prose prose-sm dark:prose-invert max-w-none wrap-break-word"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
        components={markdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </Text>
  );
}
