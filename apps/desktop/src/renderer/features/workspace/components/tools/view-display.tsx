import { useState } from "react";
import { View } from "@/components/ui/icons";
import { useOpenFileInEditor } from "../../hooks/use-open-file-in-editor";
import { FileIconComponent } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";

export interface ViewParams {
  path?: string;
}

export function ViewDisplay({ params, output, isCompact = false }: { params: ViewParams; output?: unknown; isCompact?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const openFile = useOpenFileInEditor();

  const { content, numLines } = parseViewOutput(output);
  const hasContent = !!content;
  const filePath = params.path ?? "";
  const fileName = filePath.split("/").pop() || filePath;
  const fileExt = (() => {
    const dotIdx = fileName.lastIndexOf(".");
    return dotIdx > 0 ? fileName.slice(dotIdx + 1) : undefined;
  })();

  return (
    <div>
      <ToolHeader
        icon={<View className="size-4" />}
        verb="Viewed"
        hasDetails={hasContent}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        {numLines > 0 && (
          <span className={TOOL_ROW_TEXT}>
            {numLines} lines
          </span>
        )}
        <span
          role={filePath ? "link" : undefined}
          title={filePath ? "Open in editor" : undefined}
          onClick={(e) => {
            if (!filePath) return;
            e.stopPropagation();
            openFile(filePath);
          }}
          className={`inline-flex items-center gap-1 min-w-0 ${filePath ? "cursor-pointer hover:underline hover:text-primary-950 hover:dark:text-primary" : ""} ${TOOL_ROW_TEXT}`}
        >
          {filePath && (
            <FileIconComponent
              extension={fileExt}
              fileName={fileName}
              className="size-3.5 shrink-0"
            />
          )}
          <span className="truncate">{fileName}</span>
        </span>
      </ToolHeader>

      {hasContent && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody className="text-s font-mono whitespace-pre-wrap">
            {content}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}

function parseViewOutput(output: unknown): { content: string | null; numLines: number } {
  const parsed = coerceToolOutput(output);
  if (typeof parsed === "string") {
    return { content: parsed, numLines: parsed.split("\n").filter(l => l.length > 0).length };
  }

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content : null;
    const numLines = content ? content.split("\n").filter(l => l.length > 0).length : 0;
    return { content, numLines };
  }

  return { content: null, numLines: 0 };
}
