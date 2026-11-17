import { formatSchedule } from "@/features/pulse/lib/format-schedule";
import type { PulseFrequency } from "@/lib/redux/api/pulseApi";
import { formatAbsoluteDate } from "@/lib/format-date";
import { Text } from "@/components/ui";
import { Bot } from "@/components/ui/icons";
import { useToolExpansion } from "../../lib/transcript-view-state";
import { ASSISTANT_TOOL_LABELS, assistantToolResult } from "../../lib/assistant-tool-content";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody, useToolStatus } from "./_shared";

const LABELS: Record<string, string> = {
  name: "Assistant", role: "Role", providerId: "Provider", title: "Title", description: "Description",
  prompt: "Request", status: "Status", result: "Result", evidence: "Evidence", error: "Error",
  execution: "Execution", mode: "Mode", workspaceId: "Workspace", content: "Content",
  message: "Message", query: "Search", scope: "Scope", revision: "Revision", pinned: "Pinned",
  source: "Source", expectedRevision: "Expected revision", shortDescription: "Description",
  routines: "Routines", defaultTimezone: "Default timezone", defaultExecution: "Run in",
  schedule: "Schedule", frequency: "Frequency", dayOfWeek: "Day of week", hour: "Hour", minute: "Minute", timezone: "Timezone",
  isActive: "Enabled", nextRunAt: "Next run", lastRunAt: "Last run", lastAssignmentStatus: "Last task", lastError: "Last error",
  deleted: "Deleted", createdAt: "Created", updatedAt: "Updated", goal: "Request", kind: "Type",
};
const REFERENCES = ["id", "assignmentId", "toAssistantId", "fromAssistantId", "workerRunId", "fromRunId", "runId", "parentId", "routineId", "lastRunId"];
const titleCase = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

function Details({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null || depth > 8) return null;
  if (typeof value !== "object") return <span className="whitespace-pre-wrap break-words">{typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <div className="space-y-2">{value.map((item, i) =>
    <div key={i} className={typeof item === "object" && item !== null ? "space-y-1 border-t border-primary-100 pt-2 first:border-0 first:pt-0 dark:border-primary/10" : "flex gap-2"}>
      {typeof item !== "object" && <span aria-hidden="true">•</span>}<Details value={item} depth={depth + 1} />
    </div>)}</div> : <span className="text-primary-500">None</span>;
  const record = value as Record<string, unknown>;
  const hasSchedule = ["hourly", "daily", "weekdays", "weekly"].includes(String(record.frequency)) &&
    typeof record.hour === "number" && typeof record.minute === "number";
  const presented = hasSchedule ? { ...record, schedule: formatSchedule({
    frequency: record.frequency as PulseFrequency, hour: record.hour as number, minute: record.minute as number,
    dayOfWeek: typeof record.dayOfWeek === "number" ? record.dayOfWeek : null,
  }) } : record;
  const fields = Object.entries(presented).filter(([key, val]) => Object.prototype.hasOwnProperty.call(LABELS, key) &&
    val != null && val !== "" && !(hasSchedule && ["frequency", "hour", "minute", "dayOfWeek"].includes(key)))
    .map(([key, val]) => {
      if (["createdAt", "updatedAt", "nextRunAt", "lastRunAt"].includes(key) &&
        (typeof val === "string" || typeof val === "number") && Number.isFinite(new Date(val).getTime())) {
        return [key, formatAbsoluteDate(val)] as const;
      }
      return [key, val] as const;
    });
  const refs = REFERENCES.filter(key => typeof record[key] === "string" && record[key]);
  return <div className="space-y-1">
    {fields.map(([key, val]) => <div key={key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Text as="span" size="t" tone="subtle" className="shrink-0">{LABELS[key]}</Text>
      <div className={`min-w-0 ${typeof val === "object" ? "w-full" : "flex-1"} ${key === "error" ? "text-danger" : key === "status" ? "capitalize" : ""}`}><Details value={val} depth={depth + 1} /></div>
    </div>)}
    {refs.length > 0 && <Text as="dl" size="t" tone="subtle" className="space-y-0.5">
      {refs.map(key => <div key={key} className="flex flex-wrap items-baseline gap-x-2"><dt>{titleCase(key)}</dt><dd className="min-w-0 select-text break-all font-mono">{String(record[key])}</dd></div>)}
    </Text>}
    {!fields.length && !refs.length && Object.entries(record).map(([key, val]) => <div key={key}><div className="text-t text-primary-500">{titleCase(key)}</div><Details value={val} depth={depth + 1} /></div>)}
  </div>;
}

export function AssistantToolDisplay({ toolName, params, output, isCompact = false }: {
  toolName: string; params: Record<string, unknown> | null; output?: unknown; isCompact?: boolean;
}) {
  const [expanded, setExpanded] = useToolExpansion(false);
  const status = useToolStatus();
  const result = assistantToolResult(output);
  const label = ASSISTANT_TOOL_LABELS[toolName] ?? toolName;
  const record = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
  const summary = typeof params?.title === "string" ? params.title : typeof params?.query === "string" ? params.query
    : Array.isArray(result) ? `${result.length} ${result.length === 1 ? "item" : "items"}`
    : typeof record?.title === "string" ? record.title : "";
  const hasDetails = !!params && Object.keys(params).length > 0 || result != null;
  return <div>
    <ToolHeader icon={<Bot className="size-4" />} verb={label} hasDetails={hasDetails} isExpanded={expanded}
      onToggle={() => setExpanded(v => !v)} isCompact={isCompact}>
      <span className={`truncate ${TOOL_ROW_TEXT}`}>{[isCompact ? label : "", summary].filter(Boolean).join(" · ")}</span>
      {status === "error" && <span className="text-t text-danger">Failed</span>}
    </ToolHeader>
    {hasDetails && <ToolCollapse isExpanded={expanded}><ToolOutputBody as="div" className="text-s font-sans space-y-2">
      {!!params && Object.keys(params).length > 0 && <section><Details value={params} /></section>}
      {result != null && <section className={params && Object.keys(params).length ? "border-t border-primary-100 pt-1 dark:border-primary/10" : undefined}><Details value={result} /></section>}
    </ToolOutputBody></ToolCollapse>}
  </div>;
}
