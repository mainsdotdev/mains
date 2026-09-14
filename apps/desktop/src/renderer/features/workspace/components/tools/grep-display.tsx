import { useState } from "react";
import { Grep } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";
import { shortPath } from "../../lib/path-utils";

export interface GrepParams {
  pattern?: string;
  query?: string;
  regex?: string;
  path?: string;
  output_mode?: string;
  glob?: string;
  type?: string;
  include_pattern?: string;
  exclude_pattern?: string;
}

export function GrepDisplay({ params, output, isCompact = false }: { params: GrepParams; output?: unknown; isCompact?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { content, numFiles, numLines, totalMatches, truncated } = parseGrepOutput(output);
  const hasContent = !!content;
  const showLines = numLines > 0 && (totalMatches <= 0 || numLines !== totalMatches);
  const hasStats =
    numFiles > 0 || showLines || totalMatches > 0 || truncated;

  return (
    <div>
      <ToolHeader
        icon={<Grep className="size-4" />}
        verb="Grepped"
        hasDetails={hasContent}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <code className={`font-sans truncate ${TOOL_ROW_TEXT}`}>
          {params.pattern || params.query || params.regex || ""}
        </code>
        {hasStats && (
          // shrink-0 + nowrap: the pattern beside it truncates, the stats never
          // wrap onto a second line (matches GlobDisplay's stats span).
          <span className={`shrink-0 whitespace-nowrap ${TOOL_ROW_TEXT}`}>
            ({[
              totalMatches > 0 ? `${totalMatches} matches` : null,
              showLines ? `${numLines} lines` : null,
              numFiles > 0 ? `${numFiles} files` : null,
              truncated ? "truncated" : null,
            ].filter(Boolean).join(", ")})
          </span>
        )}
      </ToolHeader>

      {hasContent && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody className="text-xs font-mono whitespace-pre-wrap">
            {content}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}

function parseGrepOutput(output: unknown): {
  content: string | null;
  numFiles: number;
  numLines: number;
  totalMatches: number;
  truncated: boolean;
} {
  const empty = { content: null, numFiles: 0, numLines: 0, totalMatches: 0, truncated: false };

  const parsed = coerceToolOutput(output);
  if (typeof parsed === "string") {
    return {
      content: parsed,
      numFiles: 0,
      numLines: parsed.split("\n").length,
      totalMatches: 0,
      truncated: false,
    };
  }

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content : null;
    const numFiles =
      typeof obj.numFiles === "number"
        ? obj.numFiles
        : typeof obj.totalFiles === "number"
          ? obj.totalFiles
          : 0;
    const numLines = typeof obj.numLines === "number" ? obj.numLines : 0;
    const totalMatches = typeof obj.totalMatches === "number" ? obj.totalMatches : 0;
    const truncated = obj.truncated === true;
    const filenames = Array.isArray(obj.filenames) ? obj.filenames as string[] : [];

    // If mode is files_with_matches and we have filenames, show them as content
    if (!content && filenames.length > 0) {
      return {
        content: filenames.map(f => shortPath(f)).join("\n"),
        numFiles: filenames.length,
        numLines,
        totalMatches,
        truncated,
      };
    }

    return { content, numFiles: numFiles || filenames.length, numLines, totalMatches, truncated };
  }

  return empty;
}
