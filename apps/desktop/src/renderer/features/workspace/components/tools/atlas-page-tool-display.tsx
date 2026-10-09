import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown-components";
import { Button, Checkbox, Text } from "@/components/ui";
import { Globe } from "@/components/ui/icons/space";
import { atlasBlocksPreview, atlasToolResult } from "../../lib/atlas-tool-content";
import { useToolExpansion } from "../../lib/transcript-view-state";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody, toPresentTense, useToolStatus } from "./_shared";

interface AtlasPageDisplayProps {
  params: Record<string, unknown> | null;
  output?: unknown;
  isCompact?: boolean;
}

const OPERATIONS = {
  read: { label: "Read Atlas page", result: "Page read", failed: "Could not read page", icon: <Globe className="size-4" /> },
  update: { label: "Updated Atlas page", result: "Page saved", failed: "Page update failed", icon: <Globe className="size-4" /> },
  create: { label: "Created Atlas page", result: "Page created", failed: "Page creation failed", icon: <Globe className="size-4" /> },
};
type Operation = keyof typeof OPERATIONS;

export function AtlasReadPageDisplay(props: AtlasPageDisplayProps) {
  return <AtlasPageDisplay {...props} operation="read" />;
}
export function AtlasUpdatePageDisplay(props: AtlasPageDisplayProps) {
  return <AtlasPageDisplay {...props} operation="update" />;
}
export function AtlasCreatePageDisplay(props: AtlasPageDisplayProps) {
  return <AtlasPageDisplay {...props} operation="create" />;
}

function AtlasPageDisplay({ operation, params, output, isCompact = false }: AtlasPageDisplayProps & { operation: Operation }) {
  const [isExpanded, setIsExpanded] = useToolExpansion(false);
  const status = useToolStatus();
  const result = useMemo(() => atlasToolResult(output), [output]);
  const spec = OPERATIONS[operation];
  const pending = status === "running" || status === "queued";
  const failed = status === "error" || result.isError;
  const canceled = status === "canceled";
  const label = failed ? spec.failed : canceled ? "Atlas page operation canceled"
    : pending ? toPresentTense(spec.label) : spec.label;
  const title = typeof result.item?.title === "string" ? result.item.title
    : typeof params?.title === "string" ? params.title : "";
  const version = typeof result.item?.version === "number" ? result.item.version : null;
  const previousVersion = typeof params?.expectedVersion === "number" ? params.expectedVersion : null;
  const versionLabel = version === null ? "" : operation === "update" && previousVersion !== null
    ? `v${previousVersion} → v${version}` : `v${version}`;
  const hasDetails = (!!params && Object.keys(params).length > 0) || (output != null && output !== "");

  return <div>
    <ToolHeader icon={spec.icon} verb={label} hasDetails={hasDetails} isExpanded={isExpanded}
      onToggle={() => setIsExpanded((value) => !value)} isCompact={isCompact}>
      <span className={`truncate ${TOOL_ROW_TEXT}`}>
        {[isCompact ? label : "", title].filter(Boolean).join(" · ")}
      </span>
      {versionLabel && <Text as="span" size="xs" tone="subtle" className="shrink-0">{versionLabel}</Text>}
      {(failed || canceled) && <Text as="span" size="xs" tone={failed ? "danger" : "subtle"} className="shrink-0">
        {failed ? "Failed" : "Canceled"}
      </Text>}
    </ToolHeader>
    {hasDetails && <ToolCollapse isExpanded={isExpanded}>
      <AtlasPageDetails operation={operation} params={params} result={result} failed={failed} canceled={canceled} />
    </ToolCollapse>}
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
    <Text as="dt" size="inherit" tone="subtle">{label}</Text>
    <Text as="dd" size="inherit" className="min-w-0 wrap-break-word">{children}</Text>
  </div>;
}

function AtlasPageDetails({ operation, params, result, failed, canceled }: {
  operation: Operation;
  params: AtlasPageDisplayProps["params"];
  result: ReturnType<typeof atlasToolResult>;
  failed: boolean;
  canceled: boolean;
}) {
  const spec = OPERATIONS[operation];
  return <ToolOutputBody as="div" className="max-h-96 space-y-3 font-sans">
    {params && <section aria-label="Input" className="space-y-2">
      <Text as="div" size="xs" tone="subtle" weight="medium">Input</Text>
      <dl className="space-y-1">
        <Field label="Page ID">{typeof params.pageId === "string" ? params.pageId : null}</Field>
        <Field label={operation === "update" ? "New title" : "Title"}>{typeof params.title === "string" ? params.title : null}</Field>
        <Field label="Expected version">{typeof params.expectedVersion === "number" ? `v${params.expectedVersion}` : null}</Field>
      </dl>
      {operation !== "read" && <PageContent markdown={params.markdown} blocks={params.blocksJson} />}
    </section>}
    {(result.item || result.message || failed || canceled) && <section aria-label={failed ? "Error" : "Output"}
      className="space-y-2 border-t border-primary-200/50 pt-2 dark:border-primary-700/30">
      <Text as="div" size="xs" tone={failed ? "danger" : "subtle"} weight="medium">{failed ? "Error" : "Output"}</Text>
      <Text as="div" size="s" tone={failed ? "danger" : canceled ? "subtle" : result.item ? "success" : "inherit"} weight="medium">
        {failed ? spec.failed : canceled ? "Operation canceled" : result.item ? spec.result : "Result"}
      </Text>
      {result.item && <dl className="space-y-1">
        <Field label="Title">{typeof result.item.title === "string" ? result.item.title : null}</Field>
        <Field label="Page ID">{typeof result.item.id === "string" ? result.item.id : null}</Field>
        <Field label="Version">{typeof result.item.version === "number" ? `v${result.item.version}` : null}</Field>
        <Field label="Blocks">{Array.isArray(result.revision?.blocks) ? result.revision.blocks.length : null}</Field>
      </dl>}
      {result.message && <Text as="div" size="s" tone={failed ? "danger" : "inherit"} className="whitespace-pre-wrap wrap-break-word">{result.message.slice(0, 8000)}</Text>}
      {result.revision && <PageContent markdown={result.revision.markdown} blocks={result.revision.blocks} />}
    </section>}
  </ToolOutputBody>;
}

function PageContent({ markdown, blocks }: { markdown: unknown; blocks: unknown }) {
  const [full, setFull] = useState(false);
  const content = typeof markdown === "string" ? markdown : null;
  const rows = useMemo(() => content === null ? atlasBlocksPreview(blocks,
    full ? Infinity : 25, full ? Infinity : 2000) : [], [content, blocks, full]);
  if (content === null && blocks === undefined) return null;
  const truncated = content !== null ? content.length > 5000 : rows.length > 24 || rows.some((row) => row.truncated);
  return <div className="space-y-1">
    <Text as="div" size="xs" tone="subtle">Content</Text>
    {content !== null ? content ? <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
      {full ? content : content.slice(0, 5000)}
    </ReactMarkdown> : <Text as="div" size="xs" tone="subtle">Empty page</Text>
      : rows.length ? <div className="space-y-1.5">
        {(full ? rows : rows.slice(0, 24)).map((row, index) => <div key={index} style={{ paddingLeft: `${Math.min(row.depth, 4)}rem` }}
          className={`flex items-start gap-1.5 whitespace-pre-wrap wrap-break-word text-s ${row.type === "heading" ? "font-semibold" : row.type === "codeBlock" ? "font-mono" : row.type === "quote" ? "border-l-2 border-primary-400 pl-2 italic" : ""}`}>
          {row.type === "checkListItem" ? <Checkbox checked={row.checked} disabled className="mt-0.5 shrink-0" />
            : row.type === "bulletListItem" ? <span aria-hidden="true">•</span>
            : row.type === "numberedListItem" ? <span>{row.number}.</span> : null}
          <span className="min-w-0">{row.text || (row.type === "paragraph" ? "\u00a0" : row.type)}{row.truncated ? "…" : ""}</span>
        </div>)}
      </div> : <Text as="div" size="xs" tone="subtle">Empty page</Text>}
    {truncated && !full && <Button variant="ghost" onClick={() => setFull(true)}>Show full content</Button>}
  </div>;
}
