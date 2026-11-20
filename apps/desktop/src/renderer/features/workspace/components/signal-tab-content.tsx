import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import type { SignalWithEntity } from "@/lib/redux/api";
import { Heading2, Button, Body, StatusBadge, Text, type StatusTone } from "@/components/ui";
import { Check, CircleDot, Minus, Refresh } from "@/components/ui/icons";

interface SignalTabContentProps {
  signal: SignalWithEntity;
}

const severityTone = {
  fatal: "danger",
  critical: "danger",
  error: "danger",
  warning: "warning",
  info: "info",
} satisfies Record<SignalWithEntity["signal"]["level"], StatusTone>;

const stateStyle = {
  open: { tone: "info", icon: CircleDot },
  resolved: { tone: "success", icon: Check },
  ignored: { tone: "neutral", icon: Minus },
  regressed: { tone: "danger", icon: Refresh },
} satisfies Record<SignalWithEntity["signal"]["state"], { tone: StatusTone; icon: typeof Check }>;

export function SignalTabContent({ signal }: SignalTabContentProps) {
  const { signal: sig, entity } = signal;
  const title = entity.title || "Untitled signal";
  const state = stateStyle[sig.state];

  return (
    <div className="h-full overflow-y-auto noscrollbar">
      <div className="max-w-210 mx-auto pt-12 pb-24 px-6 space-y-6">
        <div className="space-y-3">
          {/* Title */}
          <Heading2>{title}</Heading2>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge tone={severityTone[sig.level] ?? "neutral"} className="capitalize">
              {sig.level}
            </StatusBadge>
            <StatusBadge tone={state?.tone ?? "neutral"} icon={state?.icon} className="capitalize">
              {sig.state}
            </StatusBadge>
            <StatusBadge tone="neutral" className="capitalize">
              {sig.category}
            </StatusBadge>
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
                variant="secondary"
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
