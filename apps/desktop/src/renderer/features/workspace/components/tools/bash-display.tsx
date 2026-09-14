import { useState } from "react";
import { Bash } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";

export interface BashParams {
  command?: string;
  description?: string;
}

export function BashDisplay({ params, output, isCompact = false }: { params: BashParams; output?: unknown; isCompact?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const stdout = parseStdout(output);
  const hasDetails = !!params.command || !!stdout;

  return (
    <div>
      <ToolHeader
        icon={<Bash className="size-4" />}
        verb="Ran"
        hasDetails={hasDetails}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {params.description || params.command || "command"}
        </span>
      </ToolHeader>

      {hasDetails && stdout && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody className="text-s font-sans whitespace-pre-wrap">
            {stdout}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}

function parseStdout(output: unknown): string | null {
  const parsed = coerceToolOutput(output);
  if (typeof parsed === "string") return stripAnsi(parsed);

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.stdout === "string" && obj.stdout) return stripAnsi(obj.stdout);
    if (typeof obj.content === "string" && obj.content) return stripAnsi(obj.content);
  }

  return null;
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(input: string): string {
  return input
    .replace(ANSI_REGEX, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
