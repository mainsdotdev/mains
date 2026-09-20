import { useState } from "react";
import { BrowserCursor } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";

export interface CuaReplParams {
  /** The agent's own one-line description of the step — what the row prints. */
  title?: string;
  /** The JS driving the computer-use session (`await office.click(24); …`). */
  code?: string;
}

interface CuaReplOutput {
  /** The accessibility tree, or the server's error line. */
  text: string | null;
  /** Screenshot the step returned, ready for an `<img src>`. */
  screenshot: string | null;
}

/**
 * The computer-use REPL answers in an MCP envelope carrying two different
 * things: the accessibility tree (or an error) as text, and a PNG screenshot as
 * base64. The generic MCP display keeps only the text, which is why this one
 * exists — the screenshot is the whole point of a step like "check the layout".
 */
function parseCuaReplOutput(output: unknown): CuaReplOutput {
  const parsed = coerceToolOutput(output);
  const empty: CuaReplOutput = { text: null, screenshot: null };
  if (!parsed || typeof parsed !== "object") {
    return typeof output === "string" ? { ...empty, text: output } : empty;
  }

  const content = (parsed as { content?: unknown }).content;
  if (!Array.isArray(content)) return empty;

  const texts: string[] = [];
  let screenshot: string | null = null;
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const part = item as {
      type?: string;
      text?: string;
      data?: string;
      mimeType?: string;
    };
    if (part.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
    } else if (
      part.type === "image" &&
      typeof part.data === "string" &&
      !screenshot
    ) {
      screenshot = `data:${part.mimeType || "image/png"};base64,${part.data}`;
    }
  }

  return {
    text: texts.length > 0 ? texts.join("\n\n") : null,
    screenshot,
  };
}

export function CuaReplDisplay({
  params,
  output,
  isCompact = false,
}: {
  params: CuaReplParams;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const title = params.title?.trim() ?? "";
  const code = params.code?.trim() ?? "";
  const { text, screenshot } = parseCuaReplOutput(output);
  const hasDetails = !!code || !!text || !!screenshot;

  return (
    <div>
      <ToolHeader
        icon={<BrowserCursor className="size-4" />}
        verb="Computer use"
        hasDetails={hasDetails}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span className={`truncate ${TOOL_ROW_TEXT}`}>{title || code}</span>
      </ToolHeader>

      {hasDetails && (
        <ToolCollapse isExpanded={isExpanded}>
          <div className="flex flex-col gap-1.5">
            {code && (
              <ToolOutputBody className="text-s font-mono whitespace-pre-wrap">
                {code}
              </ToolOutputBody>
            )}
            {/* A screenshot is a quarter-megabyte data URL. `ToolCollapse`
                mounts its body only once opened, so a transcript full of
                collapsed steps never builds them. */}
            {screenshot && (
              <img
                src={screenshot}
                alt={title ? `Screenshot: ${title}` : "Computer use screenshot"}
                className="rounded-md max-h-80 w-auto object-contain bg-primary-50 dark:bg-primary/5"
              />
            )}
            {text && (
              <ToolOutputBody className="text-s font-mono whitespace-pre-wrap">
                {text}
              </ToolOutputBody>
            )}
          </div>
        </ToolCollapse>
      )}
    </div>
  );
}
