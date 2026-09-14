import { useState } from "react";
import { Mains } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader } from "./_shared";
import { Text, Tiny } from "@/components/ui";

interface PackageInfo {
  name: string;
  version?: string;
  ecosystem?: string;
}

export interface CheckPackageParams {
  packages?: PackageInfo[];
}

export function CheckPackageDisplay({
  params,
  output,
  isCompact = false,
}: {
  params: CheckPackageParams;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const packages = params.packages || [];
  const hasContent = packages.length > 0;
  const outputText = typeof output === "string" ? output : "";

  // Parse results from output text
  const results = parseResults(outputText);
  const blockedCount = results.filter((r) => r.blocked).length;
  const allPassed = hasContent && results.length > 0 && blockedCount === 0;

  const summaryText = packages.length > 0
    ? packages.map((p) => p.name).join(", ")
    : "No packages";

  return (
    <div>
      <ToolHeader
        icon={<Mains className="size-4" />}
        verb="CheckPackage"
        hasDetails={hasContent}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        {blockedCount > 0 && (
          <Text as="span" size="xs" tone="danger" weight="medium" className="shrink-0">
            {blockedCount} blocked
          </Text>
        )}
        {allPassed && (
          <Text as="span" size="xs" tone="success" weight="medium" className="shrink-0">
            passed
          </Text>
        )}
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {summaryText}
        </span>
      </ToolHeader>

      {hasContent && (
        <ToolCollapse isExpanded={isExpanded}>
          <div className="space-y-1">
            {results.length > 0 ? (
              results.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 text-xs font-mono py-0.5 ${
                    r.blocked
                      ? "text-danger"
                      : "text-success"
                  }`}
                >
                  <span>{r.blocked ? "✘" : "✔"}</span>
                  <Text as="span" size="inherit" tone="inherit" weight="medium">{r.name}</Text>
                  {r.score && (
                    <Text as="span" size="inherit" tone="subtle">
                      score: {r.score}
                    </Text>
                  )}
                  {r.reason && (
                    <Text as="span" size="inherit" tone="subtle" className="truncate">
                      {r.reason}
                    </Text>
                  )}
                </div>
              ))
            ) : (
              packages.map((p, i) => (
                <div
                  key={i}
                  className="text-xs font-mono text-primary-500 py-0.5"
                >
                  {p.name}{p.version ? `@${p.version}` : ""}{p.ecosystem && p.ecosystem !== "npm" ? ` (${p.ecosystem})` : ""}
                </div>
              ))
            )}
            {outputText && results.length === 0 && (
              <Tiny as="div" className="whitespace-pre-wrap bg-primary-50 dark:bg-primary/5 rounded-md p-2 mt-1">
                {outputText}
              </Tiny>
            )}
          </div>
        </ToolCollapse>
      )}
    </div>
  );
}

interface ParsedResult {
  name: string;
  blocked: boolean;
  score?: string;
  reason?: string;
}

function parseResults(output: string): ParsedResult[] {
  if (!output) return [];
  const results: ParsedResult[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const blocked = trimmed.startsWith("❌") || trimmed.includes("BLOCKED");
    const allowed = trimmed.startsWith("✅") || trimmed.includes("ALLOWED");
    if (!blocked && !allowed) continue;

    // Extract package name (first word after status emoji/label)
    const nameMatch = trimmed.match(/(?:ALLOWED|BLOCKED)\s+(\S+)/);
    const name = nameMatch?.[1] || "unknown";

    // Extract score
    const scoreMatch = trimmed.match(/score:\s*(\d+)\/100/);
    const score = scoreMatch?.[1];

    // Extract reason after last |
    const parts = trimmed.split("|");
    const reason = parts.length > 1 ? parts[parts.length - 1].trim() : undefined;

    results.push({ name, blocked, score, reason });
  }

  return results;
}
