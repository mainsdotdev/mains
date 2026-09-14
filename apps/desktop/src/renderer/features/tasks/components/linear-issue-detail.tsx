import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

import { markdownComponents } from "@/components/markdown-components";
import {
  Button,
  Caption,
  CircleSpinner,
  Heading2,
  Text,
} from "@/components/ui";
import { Document, External, Link } from "@/components/ui/icons";
import {
  useGetIssueDetailQuery,
  type IssueDetailReference,
  type IssueWithEntity,
} from "@/lib/redux/api";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";

function safeColor(value: string | null | undefined, fallback = "#8a8f98") {
  return value && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
}

function openExternal(url: string) {
  void window.api.shell.openExternal(url);
}

function Markdown({ children }: { children: string }) {
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
        {children}
      </ReactMarkdown>
    </Text>
  );
}


function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text as="div" size="xs" tone="muted" weight="medium" className="mb-2">
      {children}
    </Text>
  );
}

function IssueReferenceRow({ issue }: { issue: IssueDetailReference }) {
  return (
    <Button
      variant="ghost"
      onClick={() => openExternal(issue.url)}
      className="group w-full flex items-center gap-2.5 px-0 py-1.5 text-left"
    >
      <span
        className="size-2 rounded-full shrink-0"
        style={{ backgroundColor: safeColor(issue.state?.color) }}
      />
      <Text as="span" size="xs" tone="subtle" className="shrink-0">
        {issue.identifier}
      </Text>
      <Text as="span" size="s" weight="medium" className="truncate flex-1">
        {issue.title}
      </Text>
      <External className="size-3 shrink-0 opacity-0 group-hover:opacity-100 text-primary-500 transition-opacity" />
    </Button>
  );
}


export function LinearIssueDetailContent({ issue }: { issue: IssueWithEntity }) {
  const { issue: synced, entity } = issue;
  const { data: detail, isLoading, isError, refetch } = useGetIssueDetailQuery(
    synced.entityId,
  );

  const title = detail?.title || entity.title || `Issue #${synced.number ?? "?"}`;
  const description = detail?.description ?? entity.body;
  const stateName = detail?.state.name ?? synced.state;
  const stateColor = safeColor(detail?.state.color);
  const assignee = detail?.assignee?.name ?? synced.assignee;

  return (
    <div className="h-full overflow-y-auto noscrollbar">
      <div className="max-w-210 mx-auto pt-12 pb-24 px-6 space-y-6">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Heading2 className="min-w-0 flex-1 wrap-break-word">{title}</Heading2>
            {isLoading && <CircleSpinner className="size-4 mt-1.5" />}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {assignee && (
              <Text as="span" size="sm" tone="subtle">
                Assigned to{" "}
                <Text as="span" size="inherit" tone="muted" weight="medium">
                  {assignee}
                </Text>
              </Text>
            )}
            <span className="inline-flex capitalize items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-400">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: stateColor }}
              />
              {stateName}
            </span>
          </div>

        </div>


        <div className="space-y-2">
          {description ? (
            <Markdown>{description}</Markdown>
          ) : (
            <Caption>Details not synced yet or no description provided.</Caption>
          )}
        </div>

        {isError && (
          <div className="flex items-center gap-2">
            <Text size="xs" tone="subtle">
              Live Linear details could not be loaded.
            </Text>
            <Button
              variant="ghost"
              onClick={() => void refetch()}
              className="text-xs text-primary-600 dark:text-primary-400"
            >
              Retry
            </Button>
          </div>
        )}

        {detail?.parent && (
          <section>
            <SectionHeading>Parent issue</SectionHeading>
            <IssueReferenceRow issue={detail.parent} />
          </section>
        )}

        {(detail?.children.length ?? 0) > 0 && (
          <section>
            <SectionHeading>Sub-issues · {detail!.children.length}</SectionHeading>
            <div>
              {detail!.children.map((child) => (
                <IssueReferenceRow key={child.id} issue={child} />
              ))}
            </div>
          </section>
        )}

        {(detail?.resources.length ?? 0) > 0 && (
          <section>
            <SectionHeading>Resources · {detail!.resources.length}</SectionHeading>
            <div className="">
              {detail!.resources.map((resource) => (
                <Button
                  variant="ghost"
                  key={`${resource.kind}:${resource.id}`}
                  onClick={() => openExternal(resource.url)}
                  className="group w-full flex items-center gap-2.5 px-0 py-2 text-left "
                >
                  <span className="size-5 flex items-center justify-center shrink-0 text-primary-500">
                    {resource.kind === "document" ? (
                      <Document className="size-3" />
                    ) : (
                      <Link className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 ">
                    <Text as="div" size="s" weight="medium" className="truncate">
                      {resource.title}
                    </Text>

                  </div>
                </Button>
              ))}
            </div>
          </section>
        )}

        {(detail?.relations.length ?? 0) > 0 && (
          <section>
            <SectionHeading>Related issues · {detail!.relations.length}</SectionHeading>
            <div>
              {detail!.relations.map((relation) => (
                <div key={relation.id} className="flex items-center gap-2">
                  <Text size="xxs" tone="subtle" className="w-14 shrink-0 capitalize">
                    {relation.type}
                  </Text>
                  <div className="min-w-0 flex-1">
                    <IssueReferenceRow issue={relation.issue} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}


      </div>
    </div>
  );
}
