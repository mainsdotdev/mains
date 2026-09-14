import { useState } from "react";
import { Glob } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";
import { shortPath } from "../../lib/path-utils";

export interface GlobParams {
  pattern?: string;
  path?: string;
}

export function GlobDisplay({ params, output, isCompact = false }: { params: GlobParams; output?: unknown; isCompact?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { filenames, numFiles } = parseGlobOutput(output);
  const hasFiles = filenames.length > 0;

  return (
    <div>
      <ToolHeader
        icon={<Glob className="size-4" />}
        verb="Searched"
        hasDetails={hasFiles}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        {numFiles > 0 && (
          <span className={`shrink-0 whitespace-nowrap ${TOOL_ROW_TEXT}`}>
            {numFiles} files
          </span>
        )}
        <code
          className={`min-w-0 truncate font-mono text-xs ${TOOL_ROW_TEXT}`}
          title={params.pattern || undefined}
        >
          {params.pattern || "?"}
        </code>
      </ToolHeader>

      {hasFiles && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody as="div" className="text-xs font-mono">
            {filenames.map((f) => (
              <div key={f} className="truncate">{shortPath(f)}</div>
            ))}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}

function parseRawFileList(raw: string): { filenames: string[]; numFiles: number } {
  const filenames = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { filenames, numFiles: filenames.length };
}

function parseGlobOutput(output: unknown): { filenames: string[]; numFiles: number } {
  const parsed = coerceToolOutput(output);
  // Adapters that emit raw shell stdout (newline-separated paths) get a
  // best-effort fallback so the file list still renders.
  if (typeof parsed === "string") return parseRawFileList(parsed);

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const filenames = Array.isArray(obj.filenames) ? obj.filenames as string[] : [];
    const numFiles = typeof obj.numFiles === "number" ? obj.numFiles : filenames.length;
    return { filenames, numFiles };
  }

  return { filenames: [], numFiles: 0 };
}
