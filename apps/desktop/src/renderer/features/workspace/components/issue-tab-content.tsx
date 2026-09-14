import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import type { IssueWithEntity } from "@/lib/redux/api";
import { Caption, Heading2, Text } from "@/components/ui";

interface IssueTabContentProps {
  issue: IssueWithEntity;
}

function parseLabels(labels: string | null): string[] {
  if (!labels) return [];
  try {
    const parsed = JSON.parse(labels);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function IssueTabContent({ issue }: IssueTabContentProps) {
  const { issue: iss, entity } = issue;
  const labels = parseLabels(iss.labels);
  const isOpen = iss.state === "open";
  const title = entity.title || `Issue #${iss.number ?? "?"}`;

  return (
    <div className="h-full overflow-y-auto noscrollbar">
      <div className="max-w-210 mx-auto pt-12 pb-24 px-6 space-y-6">
        <div className="space-y-3">
          {/* Title */}
          <Heading2>
            {title}
          </Heading2>

          {/* State badge */}
          <div className="flex items-center gap-3 flex-wrap">
            {iss.assignee && (
              <Text as="span" size="sm" tone="subtle">
                Assigned to{" "}
                <Text as="span" size="inherit" tone="muted" weight="medium">
                  {iss.assignee}
                </Text>
              </Text>
            )}
            <span
              className={`inline-flex capitalize items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                isOpen
                  ? "bg-primary-100 dark:bg-success/30 text-success"
                  : "bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-400"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isOpen ? "bg-success" : "bg-primary-400"
                }`}
              />
              {iss.state}
            </span>
          </div>
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {labels.map((label) => (
              <span
                key={label}
                className={`inline-block glass-primary px-2.5 py-1 text-xs rounded-full capitalize font-medium text-primary-600 dark:text-primary-400`}
              >
                {label}
              </span>
            ))}
          </div>
        )}
        {/* Body */}
        <div className="space-y-2">
          {entity.body ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
                components={markdownComponents}
              >
                {entity.body}
              </ReactMarkdown>
            </div>
          ) : (
            <Caption>
              Details not synced yet or no description provided.
            </Caption>
          )}
        </div>
      </div>
    </div>
  );
}
