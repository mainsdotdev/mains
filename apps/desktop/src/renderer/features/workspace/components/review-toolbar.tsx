import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { Button, DropdownWrapper, Input, focusNextFrom } from "@/components/ui";
import { FileIconComponent, Search } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import type { ReviewDiffStyle, ReviewFile } from "../lib/review-diff";
import { searchReviewFiles } from "../lib/review-file-search";

const controlClass = "shrink-0 rounded-xl p-1.5 text-primary-500 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-900 dark:hover:text-primary-300";

function DiffLayoutIcon({ split }: { split: boolean }) {
  return <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1" />
    {split ? <>
      <path d="M5 6h6v12H5z" className="fill-danger" opacity=".65" />
      <path d="M13 6h6v12h-6z" className="fill-success" opacity=".65" />
    </> : <>
      <path d="M5 6h14v5H5z" className="fill-danger" opacity=".65" />
      <path d="M5 13h14v5H5z" className="fill-success" opacity=".65" />
    </>}
  </svg>;
}

function ReviewFileSearch({ files, anchorRef, onJump }: {
  files: readonly ReviewFile[];
  anchorRef: RefObject<HTMLElement | null>;
  onJump: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const result = useMemo(() => searchReviewFiles(files, query), [files, query]);
  const activeIndex = Math.min(active, Math.max(0, result.files.length - 1));
  const close = () => setOpen(false);
  useClickOutside(menu, close, trigger);
  useEffect(() => {
    if (open) options.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, result.files]);
  const select = (path: string) => { close(); onJump(path); };

  return <>
    <Button ref={trigger} type="button" disabled={!files.length} aria-label="Jump to file"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      tooltip="Jump to file" tooltipPosition="bottom-left" className={controlClass}
      onClick={() => { if (!open) { setQuery(""); setActive(0); } setOpen(!open); }}>
      <Search aria-hidden="true" className="size-3.5" />
    </Button>
    <DropdownWrapper id={id} isOpen={open} role="dialog" aria-label="Jump to file" usePortal
      triggerRef={anchorRef} dropdownRef={menu} position="right" animationDirection="down"
      minWidth="min-w-0" className="z-(--z-modal-critical) max-w-80 overflow-hidden p-1.5"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); trigger.current?.focus(); }
      }}>
      <div className="flex items-center gap-2 border-b border-primary-200/60 px-2 py-2 dark:border-primary-700/60">
        <Search aria-hidden="true" className="size-3.5 shrink-0 text-primary-500" />
        <Input variant="bare" autoFocus role="combobox" aria-label="Search changed files" placeholder="Jump to file"
          aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-files`}
          aria-activedescendant={result.files.length ? `${id}-file-${activeIndex}` : undefined}
          className="w-full text-xs" value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Tab") {
              event.preventDefault(); close(); requestAnimationFrame(() => focusNextFrom(trigger.current, event.shiftKey));
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (result.files.length) setActive((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + result.files.length) % result.files.length);
            } else if (event.key === "Enter" && result.files[activeIndex]) {
              event.preventDefault(); select(result.files[activeIndex].path);
            }
          }} />
      </div>
      <div id={`${id}-files`} role="listbox" aria-label="Changed files" className="max-h-64 overflow-y-auto noscrollbar py-1">
        {result.files.map((file, index) => {
          const slash = file.path.lastIndexOf("/");
          return <Button ref={(node) => { options.current[index] = node; }} id={`${id}-file-${index}`}
            key={file.path} type="button" role="option" aria-selected={index === activeIndex} aria-label={file.path}
            title={file.path} tabIndex={-1} onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()} onClick={() => select(file.path)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${index === activeIndex
              ? "bg-primary-200/60 text-primary-950 dark:bg-primary/10 dark:text-primary"
              : "text-primary-700 hover:bg-primary-200/30 dark:text-primary-300 dark:hover:bg-primary-800"}`}>
            <FileIconComponent aria-hidden="true" fileName={file.path} className="size-3.5 shrink-0" />
            <span className="min-w-0 shrink truncate">{file.path.slice(slash + 1)}</span>
            {slash >= 0 && <span className="min-w-0 flex-1 truncate text-primary-500">{file.path.slice(0, slash)}</span>}
          </Button>;
        })}
        {!result.files.length && <p className="px-2 py-4 text-xs text-primary-500">No matching files.</p>}
      </div>
      {result.total > result.files.length && <p className="px-2 pb-1 text-xxs text-primary-500">Showing {result.files.length} of {result.total} files. Search to narrow results.</p>}
    </DropdownWrapper>
  </>;
}

export function ReviewToolbar({ files, anchorRef, onJump, diffStyle, onStyleChange }: {
  files: readonly ReviewFile[];
  anchorRef: RefObject<HTMLElement | null>;
  onJump: (path: string) => void;
  diffStyle: ReviewDiffStyle;
  onStyleChange: (style: ReviewDiffStyle) => void;
}) {
  const split = diffStyle === "split";
  const label = split ? "Switch to unified diff" : "Switch to split diff";
  return <>
    <ReviewFileSearch files={files} anchorRef={anchorRef} onJump={onJump} />
    <Button type="button" aria-label={label} aria-pressed={split} tooltip={label}
      tooltipPosition="bottom-left" className={controlClass} onClick={() => onStyleChange(split ? "unified" : "split")}>
      <DiffLayoutIcon split={split} />
    </Button>
  </>;
}
