import { useMemo } from "react";
import { ASSIGNMENT_STATUSES } from "@mains/contracts/assistants";
import { formatSchedule } from "@/features/pulse/lib/format-schedule";
import { AssignmentStatusBadge } from "@/features/assistants/components/assignment-status-badge";
import { assignmentDisplayTitle, errorText } from "@/features/assistants/lib/assistant-ui";
import type { PulseFrequency } from "@/lib/redux/api/pulseApi";
import { formatAbsoluteDate } from "@/lib/format-date";
import { Text } from "@/components/ui";
import { AssistantSteps } from "@/components/ui/icons";
import { useToolExpansion } from "../../lib/transcript-view-state";
import { ASSISTANT_TOOL_LABELS, assistantToolResult } from "../../lib/assistant-tool-content";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody, toPresentTense, useToolStatus } from "./_shared";

const LABELS: Record<string, string> = {
  name: "Mate", role: "Role", providerId: "Provider", title: "Title", description: "Description",
  prompt: "Request", status: "Status", result: "Result", evidence: "Evidence", error: "Error",
  execution: "Execution", mode: "Mode", workspaceId: "Workspace", content: "Content",
  message: "Message", query: "Search", scope: "Scope", revision: "Revision", pinned: "Pinned",
  question: "Question", header: "Heading", options: "Options", label: "Choice", answer: "Answer",
  source: "Source", expectedRevision: "Expected revision", shortDescription: "Description",
  routines: "Routines", defaultTimezone: "Default timezone", defaultExecution: "Run in",
  schedule: "Schedule", frequency: "Frequency", dayOfWeek: "Day of week", hour: "Hour", minute: "Minute", timezone: "Timezone",
  isActive: "Enabled", nextRunAt: "Next run", lastRunAt: "Last run", lastAssignmentStatus: "Last task", lastError: "Last error",
  deleted: "Deleted", createdAt: "Created", updatedAt: "Updated", goal: "Request", kind: "Type",
};
const REFERENCES = ["id", "assignmentId", "toAssistantId", "fromAssistantId", "workerRunId", "fromRunId", "runId", "parentId", "routineId", "lastRunId"];
const DATES = ["createdAt", "updatedAt", "nextRunAt", "lastRunAt"];
const isLabeledField = (key: string) => Object.prototype.hasOwnProperty.call(LABELS, key);
const fieldLabel = (key: string) => isLabeledField(key) ? LABELS[key]
  : key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase()).replace(/\bId\b/g, "ID");
const readableText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const recordOf = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const titleOf = (record: Record<string, unknown> | null) => assignmentDisplayTitle(readableText(record?.title), record?.taskKey);

function hasContent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return !!value.trim();
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== "object" || Object.values(value).some(item => item != null && item !== "");
}

function displayValue(key: string, value: unknown): unknown {
  if (key === "error" || key === "lastError") return errorText(value);
  if (DATES.includes(key) && (typeof value === "string" || typeof value === "number") && Number.isFinite(new Date(value).getTime())) {
    return formatAbsoluteDate(value);
  }
  if (key === "execution" || key === "defaultExecution") {
    const execution = recordOf(value);
    if (execution?.mode === "work") return "Work";
    if (execution?.mode === "developer" && !execution.workspaceId) return "Developer";
  }
  return value;
}

function ToolResultDetails({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (!hasContent(value) || depth > 8) return null;
  if (Array.isArray(value)) {
    const records = value.some(item => recordOf(item));
    return <ul className={records ? "divide-y divide-primary-200/50 dark:divide-primary/10" : "list-disc space-y-0.5 pl-4"}>
      {value.filter(hasContent).map((item, index) => <li key={index} className={records ? "py-2 first:pt-0 last:pb-0" : undefined}>
        <ToolResultDetails value={item} depth={depth + 1} />
      </li>)}
    </ul>;
  }
  const record = recordOf(value);
  if (!record) return <span className="whitespace-pre-wrap wrap-anywhere">{typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</span>;

  const titleKey = titleOf(record) ? "title" : readableText(record.name) ? "name" : null;
  const title = titleKey === "title" ? titleOf(record) : titleKey ? readableText(record.name) : "";
  const assignmentStatus = titleKey === "title" && typeof record.prompt === "string" ? ASSIGNMENT_STATUSES.find(status => status === record.status) : undefined;
  const hasSchedule = ["hourly", "daily", "weekdays", "weekly"].includes(String(record.frequency)) &&
    typeof record.hour === "number" && typeof record.minute === "number";
  const presented = hasSchedule ? { ...record, schedule: formatSchedule({
    frequency: record.frequency as PulseFrequency, hour: record.hour as number, minute: record.minute as number,
    dayOfWeek: typeof record.dayOfWeek === "number" ? record.dayOfWeek : null,
  }) } : record;
  const fields = Object.entries(presented).filter(([key, val]) => hasContent(val) && key !== titleKey &&
    !(assignmentStatus && key === "status") && !(hasSchedule && ["frequency", "hour", "minute", "dayOfWeek"].includes(key)));
  const known = fields.filter(([key]) => isLabeledField(key) || REFERENCES.includes(key));
  const shown = known.length || title ? known : fields;
  const main = shown.filter(([key]) => !DATES.includes(key) && !REFERENCES.includes(key));
  const metadata = shown.filter(([key]) => DATES.includes(key) || REFERENCES.includes(key));
  return <div className="space-y-1">
    {title && <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Text as="span" size="s" weight="medium" className="min-w-0 wrap-anywhere">{title}</Text>
      {assignmentStatus && <AssignmentStatusBadge status={assignmentStatus} />}
    </div>}
    {!!main.length && <dl className="space-y-1">
      {main.map(([key, val]) => <div key={key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Text as="dt" size="xs" tone="subtle">{fieldLabel(key)}</Text>
        <dd className={`min-w-0 flex-1 basis-56 ${key === "error" || key === "lastError" ? "text-danger" : key === "status" ? "capitalize" : ""}`}>
          <ToolResultDetails value={displayValue(key, val)} depth={depth + 1} />
        </dd>
      </div>)}
    </dl>}
    {!!metadata.length && <Text as="dl" size="xs" tone="subtle" className="flex flex-wrap gap-x-4 gap-y-0.5">
      {metadata.map(([key, val]) => <div key={key} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <dt>{fieldLabel(key)}</dt>
        <dd className={REFERENCES.includes(key) ? "min-w-0 select-text wrap-anywhere font-mono" : undefined}>{String(displayValue(key, val))}</dd>
      </div>)}
    </Text>}
  </div>;
}

export function AssistantToolDisplay({ toolName, params, output, outputDeferred = false, isCompact = false }: {
  toolName: string; params: Record<string, unknown> | null; output?: unknown; outputDeferred?: boolean; isCompact?: boolean;
}) {
  const [expanded, setExpanded] = useToolExpansion(false);
  const status = useToolStatus();
  const result = useMemo(() => assistantToolResult(output), [output]);
  const label = ASSISTANT_TOOL_LABELS[toolName] ?? toolName;
  const [verb, ...subjectWords] = label.split(" ");
  const subject = subjectWords.join(" ");
  const record = recordOf(result);
  const target = titleOf(params) || titleOf(record) || readableText(params?.query) || readableText(params?.question) || readableText(record?.name) || subject;
  const items = Array.isArray(result) ? result : Array.isArray(record?.routines) ? record.routines : null;
  const input = Object.fromEntries(Object.entries(params ?? {}).filter(([key, value]) => hasContent(value) &&
    value !== record?.[key] && !(["assignmentId", "routineId"].includes(key) && value === record?.id)));
  const hasInput = Object.keys(input).length > 0;
  const hasOutput = Array.isArray(result) || hasContent(result);
  const visibleVerb = status === "running" || status === "queued" ? toPresentTense(verb) : verb;
  const summary = [visibleVerb, target].filter(Boolean).join(" ");
  const count = items ? `(${items.length})` : "";
  const outcome = status === "error" ? "Failed" : status === "canceled" ? "Canceled" : "";

  return (
    <div>
      <ToolHeader icon={<AssistantSteps className="size-4" aria-hidden />} verb={verb} hasDetails={hasInput || hasOutput || outputDeferred} isExpanded={expanded}
        ariaLabel={[summary, count, outcome].filter(Boolean).join(" ")}
        onToggle={() => setExpanded(value => !value)} isCompact={isCompact}>
        <span className={`min-w-0 truncate ${TOOL_ROW_TEXT}`}>{isCompact ? summary : target}</span>
        {count && <span className={`shrink-0 tabular-nums ${TOOL_ROW_TEXT}`}>{count}</span>}
        {outcome && <Text as="span" size="xs" tone={status === "error" ? "danger" : "subtle"} className="shrink-0">{outcome}</Text>}
      </ToolHeader>
      {(hasInput || hasOutput) && <ToolCollapse isExpanded={expanded}>
        <ToolOutputBody as="div" className="space-y-2 font-sans text-xs">
          {hasOutput && <section aria-label={status === "error" ? "Error" : "Output"} className="space-y-1">
            {items?.length === 0 && <Text as="p" size="xs" tone="subtle">{verb === "Listed" ? `No ${subject}` : "No results"}</Text>}
            <ToolResultDetails value={result} />
          </section>}
          {hasInput && <section aria-label="Input" className={hasOutput ? "space-y-1 border-t border-primary-200/50 pt-2 dark:border-primary/10" : undefined}>
            {hasOutput && <Text as="h3" size="xs" tone="subtle" weight="medium">Input</Text>}
            <ToolResultDetails value={input} />
          </section>}
        </ToolOutputBody>
      </ToolCollapse>}
    </div>
  );
}
