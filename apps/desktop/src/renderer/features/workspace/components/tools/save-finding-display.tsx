import { useState } from "react";
import { Mains } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader } from "./_shared";
import { Text, Tiny } from "@/components/ui";
import { SEVERITY_TINT } from "../../lib/severity";
import { shortPath } from "../../lib/path-utils";

interface Finding {
  severity?: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  message?: string;
  reason?: string;
  suggestion?: string;
}

export interface SaveFindingParams {
  // Single finding
  reviewId?: string;
  severity?: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  message?: string;
  reason?: string;
  suggestion?: string;
  // Batch findings
  findings?: Finding[];
}


export function SaveFindingDisplay({
  params,
  isCompact = false,
}: {
  params: SaveFindingParams;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Normalize to array of findings
  const findings: Finding[] = params.findings?.length
    ? params.findings
    : params.file
      ? [{ severity: params.severity, file: params.file, lineStart: params.lineStart, lineEnd: params.lineEnd, message: params.message, reason: params.reason, suggestion: params.suggestion }]
      : [];

  const hasFindings = findings.length > 0;

  // Count by severity
  const critical = findings.filter(f => f.severity === "critical").length;
  const warning = findings.filter(f => f.severity === "warning").length;
  const info = findings.filter(f => f.severity === "info").length;

  return (
    <div>
      <ToolHeader
        icon={<Mains className="size-4" />}
        verb="Saved findings"
        hasDetails={hasFindings}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <Text as="span" size="inherit" tone="faint" className="flex items-center gap-1.5">
          {critical > 0 && <Text as="span" size="inherit" tone="danger">{critical} critical</Text>}
          {warning > 0 && <Text as="span" size="inherit" tone="warning">{warning} warning</Text>}
          {info > 0 && <Text as="span" size="inherit" tone="inherit" className="text-accent">{info} info</Text>}
        </Text>
        {findings.length === 1 && findings[0].file && (
          <span className={`truncate text-xs font-mono ${TOOL_ROW_TEXT}`}>
            {shortPath(findings[0].file)}
          </span>
        )}
      </ToolHeader>

      {hasFindings && (
        <ToolCollapse isExpanded={isExpanded}>
          <div className="space-y-2">
            {findings.map((f) => (
              <div key={`${f.file ?? ""}:${f.lineStart ?? ""}:${f.severity ?? ""}`} className="bg-primary-50 dark:bg-primary/5 rounded-md p-2 space-y-1">
                <Text as="div" size="xs" tone="inherit" className="flex items-center gap-2">
                  {f.severity && (
                    <span className={`px-1.5 py-0.5 rounded font-medium ${(SEVERITY_TINT as Record<string, string>)[f.severity] ?? "bg-primary-500/10 text-primary-500"}`}>
                      {f.severity}
                    </span>
                  )}
                  {f.file && (
                    <Text as="span" size="inherit" tone="contrast" className="font-mono">
                      {shortPath(f.file)}
                      {f.lineStart != null && `:${f.lineStart}${f.lineEnd != null && f.lineEnd !== f.lineStart ? `-${f.lineEnd}` : ""}`}
                    </Text>
                  )}
                </Text>
                {f.message && (
                  <Tiny as="div" className="whitespace-pre-wrap bg-primary-50 dark:bg-primary/5 rounded-md p-2">{f.message}</Tiny>
                )}
                {f.suggestion && (
                  <Text size="xs" tone="success">{f.suggestion}</Text>
                )}
              </div>
            ))}
          </div>
        </ToolCollapse>
      )}
    </div>
  );
}

