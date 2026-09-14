import { useState } from "react";
import { Text } from "@/components/ui";
import { Workflow } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";

/**
 * Input to the `Workflow` tool. A run is launched either from an inline
 * `script` (which starts with `export const meta = { name, description, phases }`)
 * or by resuming an existing script file (`scriptPath` + `resumeFromRunId`).
 * Predefined workflows are launched by `name`.
 */
export interface WorkflowParams {
  script?: string;
  scriptPath?: string;
  resumeFromRunId?: string;
  name?: string;
}

interface WorkflowPhase {
  title: string;
  detail?: string;
}

interface WorkflowMeta {
  name?: string;
  description?: string;
  phases: WorkflowPhase[];
}

interface WorkflowResult {
  taskId?: string;
  runId?: string;
  summary?: string;
  launched: boolean;
}

export function WorkflowDisplay({
  params,
  output,
  isCompact = false,
}: {
  params: WorkflowParams;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const meta = parseWorkflowScript(params.script);
  const result = parseWorkflowOutput(output);

  // Prefer the script's declared name, then the launch summary, then a
  // predefined-workflow name / resumed run id.
  const shortRun = params.resumeFromRunId?.replace(/^wf_/, "");
  const title =
    meta.name ||
    params.name ||
    (shortRun ? `Resumed ${shortRun}` : "") ||
    result.summary ||
    "Workflow";

  const description = meta.description || result.summary;
  const hasDetails =
    meta.phases.length > 0 ||
    !!description ||
    !!result.runId ||
    !!result.taskId;

  return (
    <div>
      <ToolHeader
        icon={<Workflow className="size-4" />}
        verb="Workflow"
        hasDetails={hasDetails}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {title}
        </span>
        {meta.phases.length > 0 && (
          <span className={`shrink-0 ${TOOL_ROW_TEXT}`}>
            {meta.phases.length} phase{meta.phases.length !== 1 ? "s" : ""}
          </span>
        )}
      </ToolHeader>

      {hasDetails && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody as="div" className="text-s font-sans space-y-2">
            {description && (
              <Text as="p" size="inherit" tone="subtle" className="whitespace-pre-wrap">
                {description}
              </Text>
            )}

            {meta.phases.length > 0 && (
              <ol className="space-y-1">
                {meta.phases.map((phase, i) => (
                  <li key={`${phase.title}-${i}`} className="flex gap-2">
                    <Text as="span" size="t" tone="inherit" weight="medium" className="shrink-0 mt-px flex size-4 items-center justify-center rounded bg-primary-100 dark:bg-primary/10 tabular-nums">
                      {i + 1}
                    </Text>
                    <span className="min-w-0">
                      <Text as="span" size="inherit" tone="inherit" weight="medium">{phase.title}</Text>
                      {phase.detail && (
                        <Text as="span" size="inherit" tone="subtle">
                          {" — "}
                          {phase.detail}
                        </Text>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {(result.runId || result.taskId || params.scriptPath) && (
              <Text as="div" size="t" tone="subtle" className="pt-1 border-t border-primary-100 dark:border-primary/10 space-y-0.5 font-mono">
                {result.launched && <div>Launched in background</div>}
                {result.runId && (
                  <div>
                    <Text as="span" size="inherit" tone="subtle">Run</Text>{" "}
                    {result.runId}
                  </div>
                )}
                {result.taskId && (
                  <div>
                    <Text as="span" size="inherit" tone="subtle">Task</Text>{" "}
                    {result.taskId}
                  </div>
                )}
                {params.resumeFromRunId && (
                  <div>
                    <Text as="span" size="inherit" tone="subtle">Resumed from</Text>{" "}
                    {params.resumeFromRunId}
                  </div>
                )}
              </Text>
            )}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}

/**
 * Pull the first single/double/back-quoted string value for `key` out of a JS
 * source snippet. Handles escaped characters inside the quotes so descriptions
 * containing apostrophes survive.
 */
function extractQuoted(src: string, key: string): string | undefined {
  const re = new RegExp(`${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`);
  const m = src.match(re);
  return m ? m[2].replace(/\\(['"`\\])/g, "$1") : undefined;
}

/**
 * Parse the workflow script's `meta` block (name, description, phases). The
 * script is real JS, not JSON, so we extract the literal fields by regex rather
 * than evaluating it. Returns empty phases when there is no script (resume /
 * predefined-name launches).
 */
function parseWorkflowScript(script: string | undefined): WorkflowMeta {
  if (!script) return { phases: [] };

  const name = extractQuoted(script, "name");
  const description = extractQuoted(script, "description");

  const phases: WorkflowPhase[] = [];
  const phasesBlock = script.match(/phases\s*:\s*\[([\s\S]*?)\]/);
  if (phasesBlock) {
    const objRe = /\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = objRe.exec(phasesBlock[1])) !== null) {
      const title = extractQuoted(m[1], "title");
      if (title) phases.push({ title, detail: extractQuoted(m[1], "detail") });
    }
  }

  return { name, description, phases };
}

/**
 * The `Workflow` tool output is a human-readable launch receipt string
 * ("Workflow launched in background. Task ID: … / Run ID: … / Summary: …").
 * Pull the useful identifiers out of it.
 */
function parseWorkflowOutput(output: unknown): WorkflowResult {
  const parsed = coerceToolOutput(output);
  const text = typeof parsed === "string" ? parsed : typeof output === "string" ? output : "";
  if (!text) return { launched: false };

  return {
    taskId: text.match(/Task ID:\s*(\S+)/)?.[1],
    runId: text.match(/Run ID:\s*(\S+)/)?.[1],
    summary: text.match(/Summary:\s*(.+)/)?.[1]?.trim(),
    launched: /launched in background/i.test(text),
  };
}
