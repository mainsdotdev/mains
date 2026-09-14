import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import type { SignalWithEntity } from "@/lib/redux/api";
import { Heading2, Button, Body, Text } from "@/components/ui";

interface SignalTabContentProps {
  signal: SignalWithEntity;
}

const levelColors: Record<string, string> = {
  fatal: "bg-red-100 dark:bg-red-900/30 text-danger",
  critical: "bg-red-100 dark:bg-red-900/30 text-danger",
  error:
    "bg-orange-100 dark:bg-orange-900/30 text-warning",
  warning:
    "bg-yellow-100 dark:bg-yellow-900/30 text-warning",
  info: "bg-blue-100 dark:bg-blue-900/30 text-accent",
};

const stateColors: Record<string, string> = {
  open: "bg-green-100 dark:bg-green-900/30 text-success",
  resolved:
    "bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-400",
  ignored:
    "bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-400",
  regressed: "bg-red-100 dark:bg-red-900/30 text-danger",
};

export function SignalTabContent({ signal }: SignalTabContentProps) {
  const { signal: sig, entity } = signal;
  const title = entity.title || "Untitled signal";

  return (
    <div className="h-full overflow-y-auto noscrollbar">
      <div className="max-w-210 mx-auto pt-12 pb-24 px-6 space-y-6">
        <div className="space-y-3">
          {/* Title */}
          <Heading2>{title}</Heading2>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex capitalize items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                levelColors[sig.level] ?? levelColors.error
              }`}
            >
              {sig.level}
            </span>
            <span
              className={`inline-flex capitalize items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                stateColors[sig.state] ?? stateColors.open
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  sig.state === "open"
                    ? "bg-green-500"
                    : sig.state === "regressed"
                      ? "bg-red-500"
                      : "bg-primary-400"
                }`}
              />
              {sig.state}
            </span>
            <Text as="span" size="xs" tone="subtle" weight="medium" className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary-100 dark:bg-primary-800 capitalize">
              {sig.category}
            </Text>
          </div>
        </div>

        {/* Meta info */}
        <Text as="div" size="sm" tone="subtle" className="flex items-center gap-4 flex-wrap">
          <span>
            Source:{" "}
            <Text as="span" size="inherit" tone="muted" weight="medium" className="capitalize">
              {sig.source}
            </Text>
          </span>
          {sig.eventCount > 1 && (
            <span>
              Events:{" "}
              <Text as="span" size="inherit" tone="muted" weight="medium" className="tabular-nums">
                {sig.eventCount}
              </Text>
            </span>
          )}
          {sig.affectedUsers != null && sig.affectedUsers > 0 && (
            <span>
              Affected users:{" "}
              <Text as="span" size="inherit" tone="muted" weight="medium" className="tabular-nums">
                {sig.affectedUsers}
              </Text>
            </span>
          )}
          {sig.assignee && (
            <span>
              Assigned to{" "}
              <Text as="span" size="inherit" tone="muted" weight="medium">
                {sig.assignee}
              </Text>
            </span>
          )}
        </Text>

        {/* File location */}
        {sig.file && (
          <Text as="div" size="sm" tone="subtle">
            <Text as="span" size="xs" tone="inherit" className="font-mono bg-primary-100 dark:bg-primary-800 px-2 py-1 rounded">
              {sig.file}
              {sig.function ? `:${sig.function}` : ""}
              {sig.line ? `:${sig.line}` : ""}
            </Text>
          </Text>
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
            <Body>No description provided.</Body>
          )}
        </div>

        {/* Stack trace */}
        {sig.stackTrace && (
          <div className="space-y-2">
            <Body tone="muted" weight="medium">
              Stack Trace
            </Body>
            <Text as="pre" size="xs" tone="muted" className="font-mono bg-primary-50 dark:bg-primary-800 p-4 rounded-xl overflow-x-auto whitespace-pre-wrap">
              {sig.stackTrace}
            </Text>
          </div>
        )}

        {entity.url && (
          <div>
            <Text className="mt-0.5">
              <Button
                variant="primary"
                className="px-3 py-2.5 dark:text-primary-200 font-medium rounded-xl"
                onClick={() => window.api.shell.openExternal(entity.url!)}
              >
                View on{" "}
                {sig.source.charAt(0).toUpperCase() + sig.source.slice(1)}
              </Button>
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
