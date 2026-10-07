import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { PR_MEDIA_TYPES } from "@mains/contracts/pr-attachments";
import { Button, Input, Text, Textarea } from "@/components/ui";
import { Attach, Close, Link } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatPrMarkdown, type PrMarkdownAction } from "../../../lib/pr-markdown";
import type { PrMediaAsset } from "../../../hooks/use-pr-attachments";
import { insertPrMedia, type PrEditorSelection } from "../../../lib/pr-media-markdown";
import { GenerateButton, ShinePlaceholder } from "./controls";
import { PrDescriptionPreview } from "./pr-description-preview";

const tools: { action: PrMarkdownAction; label: string; glyph: ReactNode }[] = [
  { action: "heading", label: "Heading", glyph: "H" },
  { action: "bold", label: "Bold", glyph: <strong>B</strong> },
  { action: "italic", label: "Italic", glyph: <i>I</i> },
  { action: "quote", label: "Quote", glyph: "❞" },
  { action: "code", label: "Code", glyph: <span className="text-xs">&lt;/&gt;</span> },
  { action: "link", label: "Insert link", glyph: <Link /> },
  { action: "numbered", label: "Numbered list", glyph: <span className="text-xs">1.</span> },
  { action: "bullet", label: "Bullet list", glyph: <span>•</span> },
  { action: "checklist", label: "Task list", glyph: <span className="text-xs">☑</span> },
];
export function PrDescriptionEditor({ value, onChange, expanded, disabled, generating, onGenerate,
  assets, onAddFiles, onRemoveFile, mode, onModeChange, selectionRef }: {
  value: string; onChange: (value: string) => void; expanded: boolean; disabled: boolean;
  generating: boolean; onGenerate: () => void; assets: PrMediaAsset[];
  onAddFiles: (files: File[]) => PrMediaAsset[]; onRemoveFile: (id: string) => void;
  mode: "write" | "preview"; onModeChange: (mode: "write" | "preview") => void;
  selectionRef: RefObject<PrEditorSelection>;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const rememberSelection = (input: HTMLTextAreaElement) => {
    selectionRef.current = { value: input.value, start: input.selectionStart, end: input.selectionEnd };
  };
  const apply = (edit: { value: string; start: number; end: number }) => {
    selectionRef.current = edit;
    onChange(edit.value);
    onModeChange("write");
    requestAnimationFrame(() => { const input = textarea.current; input?.focus(); input?.setSelectionRange(edit.start, edit.end); });
  };
  const insert = (files: PrMediaAsset[]) => {
    if (!files.length || disabled) return;
    apply(insertPrMedia(value, selectionRef.current, files.map((asset) => ({ id: asset.id, name: asset.file.name, type: asset.type }))));
  };
  const add = (files: File[]) => { if (!disabled) insert(onAddFiles(files)); };
  const format = (action: PrMarkdownAction) => {
    const input = textarea.current;
    if (!input || disabled) return;
    const edit = formatPrMarkdown(value, input.selectionStart, input.selectionEnd, action);
    apply(edit);
  };
  return (
    <div className={cn("glass-input relative flex min-w-0 flex-col overflow-hidden rounded-xl", expanded && "min-h-56 flex-1",
      dragging && "ring-2 ring-accent")}
      onDragOver={(event) => { if (!disabled && event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); setDragging(false);
        add(Array.from(event.dataTransfer.files));
      }}>
      <div className="flex flex-wrap items-center gap-1 border-b border-primary-200/50 px-2 pt-1 dark:border-primary-800/50">
        <div role="tablist" aria-label="Description view" className="mr-auto flex gap-1">
          {(["write", "preview"] as const).map((tab) => (
            <Button key={tab} role="tab" id={`${id}-${tab}`} aria-controls={`${id}-content`} aria-selected={mode === tab}
              onClick={() => onModeChange(tab)} className={cn("border-b-2 px-2 py-2 text-xs focus-visible:ring-2 focus-visible:ring-accent/40",
                mode === tab ? "border-accent text-primary-900 dark:text-primary-100" : "border-transparent text-primary-500")}>
              {tab === "write" ? "Write" : "Preview"}
            </Button>
          ))}
        </div>
        {mode === "write" && <div role="toolbar" aria-label="Markdown formatting" className="flex flex-wrap gap-0.5 pb-1">
          {tools.map((tool) => <Button key={tool.action} variant="icon" iconSize="sm" aria-label={tool.label} tooltip={tool.label}
            disabled={disabled} onClick={() => format(tool.action)}>{tool.glyph}</Button>)}
        </div>}
      </div>
      <div id={`${id}-content`} role="tabpanel" aria-labelledby={`${id}-${mode}`} className={cn("relative min-h-0", expanded && "flex-1")}>
        {mode === "write" ? <>
          <Textarea ref={textarea} variant="bare" aria-label="Pull request description" value={value}
            onChange={(event) => { onChange(event.target.value); rememberSelection(event.target); }}
            onSelect={(event) => rememberSelection(event.currentTarget)} onBlur={(event) => rememberSelection(event.currentTarget)}
            disabled={disabled} rows={expanded ? 10 : 5}
            placeholder={generating ? "" : "Description (optional, leave blank to generate)…"}
            className={cn("block w-full resize-y px-3 py-3 leading-relaxed", expanded ? "h-full min-h-0 resize-none text-sm" : "min-h-32 text-xs")}
            onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); rememberSelection(event.currentTarget); add(Array.from(event.clipboardData.files)); } }}
            onKeyDown={(event) => {
              if (!(event.metaKey || event.ctrlKey)) return;
              const action = ({ b: "bold", i: "italic", k: "link" } as const)[event.key.toLowerCase() as "b" | "i" | "k"];
              if (action) { event.preventDefault(); format(action); }
            }} />
          {generating && !value && <ShinePlaceholder size={expanded ? "sm" : "xs"}>Generating description…</ShinePlaceholder>}
        </> : <div className={cn("overflow-y-auto px-3 py-3 text-sm wrap-break-word", expanded ? "h-full" : "max-h-80 min-h-32")}>
          <PrDescriptionPreview value={value} assets={assets} />
        </div>}
      </div>
      {assets.length > 0 && <div aria-label="PR attachments" className="flex min-w-0 shrink-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden border-t border-primary-200/50 p-2 dark:border-primary-800/50">
        {assets.map((asset) => <div key={asset.id} className="flex min-w-0 max-w-full shrink-0 items-center gap-2 rounded-lg bg-primary-100/60 px-2 py-1.5 dark:bg-primary-800/40">
          {asset.type.startsWith("image/") ? <img src={asset.url} alt="" className="size-8 shrink-0 rounded object-cover" /> : <span className="text-xs text-primary-500">VIDEO</span>}
          <div className="min-w-0"><Text size="xs" className="block max-w-36 truncate" title={asset.file.name}>{asset.file.name}</Text>
            <Text size="xs" tone="subtle">{asset.file.size < 1024 * 1024 ? `${Math.max(1, Math.ceil(asset.file.size / 1024))} KB` : `${(asset.file.size / 1024 / 1024).toFixed(1)} MB`}</Text></div>
          <Button variant="icon" iconSize="xs" aria-label={`Insert ${asset.file.name} at cursor`} tooltip="Insert at cursor" disabled={disabled} onClick={() => insert([asset])}><Link /></Button>
          <Button variant="icon" iconSize="xs" aria-label={`Remove ${asset.file.name}`} disabled={disabled} onClick={() => onRemoveFile(asset.id)}><Close /></Button>
        </div>)}
      </div>}
      <div className="relative flex min-h-12 shrink-0 items-center gap-2 border-t border-primary-200/50 px-3 pr-28 dark:border-primary-800/50">
        <Input ref={picker} type="file" variant="bare" aria-label="Attach images or videos" className="hidden" multiple disabled={disabled}
          accept={Object.keys(PR_MEDIA_TYPES).map((ext) => `.${ext}`).join(",")}
          onChange={(event) => { add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <Button variant="icon" aria-label="Add images or videos" tooltip="Add images or videos" disabled={disabled} onClick={() => picker.current?.click()}><Attach /></Button>
        <Text size="xs" tone="subtle" className="min-w-0 truncate">Paste or drop media</Text>
        <GenerateButton onClick={onGenerate} disabled={disabled} generating={generating} tooltip="Generate the title and description from the branch" />
      </div>
      {assets.length > 0 && <Text size="xs" tone="subtle" className="px-3 pb-2">Media is inserted at the cursor and uploaded when you create the PR.</Text>}
      {dragging && <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary-100/90 text-sm text-accent dark:bg-primary-900/90">Drop images or videos</div>}
    </div>
  );
}
