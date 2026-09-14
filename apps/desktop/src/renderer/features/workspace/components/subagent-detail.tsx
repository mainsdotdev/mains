import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { Check, Close, Minimize, Stop } from "@/components/ui/icons";
import { AgentGlyph, Button, Text } from "@/components/ui";
import {
  useGetRunArtifactsQuery,
  useGetToolCallsByRunQuery,
} from "@/lib/redux/api";
import { useRunEventRefetch } from "../hooks/use-run-event-refetch";
import { mapToolCallToEvent } from "../lib/run-event-mappers";
import { selectSubagentEntry } from "../lib/select-subagents";
import {
  buildSubagentFlow,
  selectSubagentReport,
} from "../lib/subagent-flow";
import {
  AGENT_ID_IN_RESULT,
  subagentDisplay,
  type SubagentLifecycleMeta,
  type SubagentLifecycleState,
  type SubagentTaskMeta,
} from "../lib/subagent-identity";
import { ToolCallItem } from "./tools/tool-call-item";

/** 88_000 → "1m 28s"; sub-minute → "42s". */
function formatWorkedFor(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

const EMPTY_ARTIFACTS: never[] = [];

function StateBadge({ state }: { state: SubagentLifecycleState }) {
  if (state === "done") return <Check className="size-4 text-success" />;
  if (state === "failed") return <Close className="size-4 text-danger" />;
  if (state === "stopped") return <Stop className="size-4 text-warning" />;
  return null;
}

/**
 * One subagent's session in chat-flow form: header (back + name + outcome),
 * "worked for", the task prompt, the agent's tool calls, messages, and
 * continuation turns (SendMessage) interleaved in execution order, and its
 * final report. Sized for the bottom-right subagent panel's expanded state.
 *
 * Data comes from what the run already persisted — child tool calls linked via
 * `parentToolCallId` and message artifacts tagged with `parentToolUseId` — so
 * the view works live (refreshed off the persisted-event signal) and after
 * the run ends.
 */
export function SubagentDetail({
  runId,
  subagentId,
  title,
  onBack,
}: {
  runId: string;
  /** Provider tool-use id of the spawning call. */
  subagentId: string;
  /** Display-name fallback until the spawn row loads. */
  title: string;
  onBack: () => void;
}) {
  const { data: toolCalls, refetch: refetchToolCalls } =
    useGetToolCallsByRunQuery(runId, { refetchOnMountOrArgChange: true });
  const { data: artifactRows, refetch: refetchArtifacts } =
    useGetRunArtifactsQuery(runId, { refetchOnMountOrArgChange: true });
  // Stable empty fallback — a fresh `[]` per render would churn the flow memo.
  const artifacts = artifactRows ?? EMPTY_ARTIFACTS;

  // Live refresh off the persisted-event signal — one coalesced burst
  // refreshes both sources.
  useRunEventRefetch(runId, () => {
    void refetchArtifacts();
    void refetchToolCalls();
  });

  const spawn = useMemo(
    () => (toolCalls ?? []).find((call) => call.toolCallId === subagentId),
    [toolCalls, subagentId],
  );
  const meta = (spawn?.metadata?.subagent ?? {}) as SubagentLifecycleMeta;
  const task = spawn?.metadata?.task as SubagentTaskMeta | undefined;

  // Identity and state come from the same selection the panel list renders —
  // see selectSubagentEntry for why this must not be re-derived here.
  const entry = useMemo(
    () => selectSubagentEntry(toolCalls ?? [], subagentId),
    [toolCalls, subagentId],
  );
  const display = entry
    ? subagentDisplay(entry)
    : { name: title, detail: undefined };
  const state: SubagentLifecycleState = entry?.state ?? "running";

  // The agent's continuation handle — SendMessage turns addressed to it are
  // part of THIS agent's session, not new agents.
  const agentId = meta.agentId ?? meta.result?.match(AGENT_ID_IN_RESULT)?.[1];

  const flow = useMemo(
    () =>
      buildSubagentFlow({
        subagentId,
        agentId,
        toolCalls: toolCalls ?? [],
        artifacts,
      }),
    [toolCalls, artifacts, subagentId, agentId],
  );

  const workedMs =
    typeof meta.invokedAt === "number" &&
    typeof meta.updatedAt === "number" &&
    meta.updatedAt > meta.invokedAt
      ? meta.updatedAt - meta.invokedAt
      : undefined;

  // A backgrounded agent has no tool_result report; its outcome arrives as
  // the task notification's summary, so that is the fallback. Dedup against
  // the flow's last message lives in the lib with the rest of the assembly.
  const resultText = selectSubagentReport(meta.result ?? task?.summary, flow);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header stays pinned while the flow scrolls beneath it. */}
      <div className="flex items-center gap-2 border-b border-primary-200/40 px-4 py-3 dark:border-primary-700/25">
        <AgentGlyph
          seed={display.name}
          active={state === "running"}
          className="size-4"
        />
        <Text as="span" size="sm" tone="muted" weight="medium" className="min-w-0 flex-1 truncate">
          {display.name}
        </Text>
        {workedMs !== undefined && (
          <Text as="span" size="xs" tone="muted" className="shrink-0 tabular-nums">
            {formatWorkedFor(workedMs)}
          </Text>
        )}
        <StateBadge state={state} />
        <Button
          onClick={onBack}
          title="Back to subagents"
          aria-label="Back to subagents"
          className="shrink-0 rounded-md p-0.5 text-primary-600 transition-colors hover:bg-primary-50 hover:text-primary-900 dark:text-primary-400 dark:hover:bg-primary/5 dark:hover:text-primary-100"
        >
          <Minimize className="size-4 scale-x-[-1] text-primary-700 dark:text-primary-300 " />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 noscrollbar">
        {display.detail && (
          <Text as="span" size="xs" tone="subtle" className="block">
            {display.detail}
          </Text>
        )}

        {meta.prompt && (
          <Text as="div" size="sm" tone="muted" className="rounded-xl bg-primary-50 px-3 py-2.5 whitespace-pre-wrap dark:bg-primary/5">
            {meta.prompt}
          </Text>
        )}

        {flow.length === 0 && !resultText && !meta.error && (
          <Text as="p" tone="subtle">
            {state === "running"
              ? "No activity recorded yet."
              : "No activity was recorded for this agent."}
          </Text>
        )}

        <div className="space-y-1">
          {flow.map((item) =>
            item.kind === "prompt" ? (
              // A continuation turn — the parent messaging this agent again.
              // Same bubble language as the task prompt above.
              <div
                key={item.key}
                className="my-3 rounded-xl bg-primary-50 px-3 py-2.5 text-sm whitespace-pre-wrap text-primary-700 dark:bg-primary/5 dark:text-primary-300"
              >
                {item.content}
              </div>
            ) : item.kind === "message" ? (
              <div
                key={item.key}
                className="prose prose-sm dark:prose-invert max-w-none"
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[
                    rehypeRaw,
                    [rehypeSanitize, markdownSanitizeSchema],
                  ]}
                  components={markdownComponents}
                >
                  {item.content}
                </ReactMarkdown>
              </div>
            ) : (
              // isCompact={false} — the compact variant is for rows inside a
              // sub-group accordion whose header already carries the icon and
              // tool name; standalone rows need both (see ToolSubGroupAccordion).
              <ToolCallItem
                key={item.key}
                event={mapToolCallToEvent(item.call)!}
                isCompact={false}
              />
            ),
          )}
        </div>

        {resultText && (
          <div className="prose prose-sm dark:prose-invert max-w-none border-t border-primary-200/60 pt-3 dark:border-primary-800/60">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[
                rehypeRaw,
                [rehypeSanitize, markdownSanitizeSchema],
              ]}
              components={markdownComponents}
            >
              {resultText}
            </ReactMarkdown>
          </div>
        )}

        {meta.error && <Text as="p" size="sm" tone="danger">{meta.error}</Text>}
      </div>
    </div>
  );
}
