import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReviewComment } from "@mains/contracts/review-comments";
import { Button, DropdownWrapper } from "@/components/ui";
import { Chat, Close } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useComposerContext } from "../hooks/use-composer-context";
import { ReviewCommentCard } from "./review-comment-card";

/** The same attachment presents editable drafts and immutable sent comments. */
export function ReviewCommentsAttachment({ comments, onUpdate, onRemove }: {
  comments: readonly ReviewComment[];
  onUpdate?: (id: string, text: string) => void;
  onRemove?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<"left" | "right">("left");
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  if (open && !comments.length) setOpen(false);
  useClickOutside(panel, close, trigger);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);
  if (!comments.length) return null;
  const summary = `${comments.length} review comment${comments.length === 1 ? "" : "s"}`;
  return <>
    <div className="glass-input flex max-w-full items-center self-end rounded-xl">
      <Button ref={trigger} type="button" aria-label={summary} aria-haspopup="dialog"
        aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => {
          setPosition((trigger.current?.getBoundingClientRect().left ?? 0) > window.innerWidth / 2 ? "right" : "left");
          setOpen(!open);
        }}
        className="flex min-w-0 items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-primary-800 dark:text-primary-200">
        <Chat className="size-3.5 shrink-0 text-primary-500" /><span className="truncate">{summary}</span>
      </Button>
      {onRemove && <Button type="button" aria-label="Remove all review comments" onClick={() => { comments.forEach((comment) => onRemove(comment.id)); close(); }}
        className="mr-1 rounded-full p-1 text-primary-500"><Close className="size-3" /></Button>}
    </div>
    <DropdownWrapper id={id} isOpen={open} usePortal position={position} openUpward={!!onUpdate} triggerRef={trigger} dropdownRef={panel}
      className="z-(--z-modal-critical)"
      matchTriggerWidth={false} minWidth="min-w-0" role="dialog" aria-label="Review comments">
      <div className="max-h-[min(28rem,65vh)] w-[min(26rem,calc(100vw-2rem))] space-y-2 overflow-y-auto rounded-2xl ">
        {comments.map((comment) => <ReviewCommentCard key={comment.id} comment={comment}
          onUpdate={onUpdate ? (text) => onUpdate(comment.id, text) : undefined}
          onRemove={onRemove ? () => onRemove(comment.id) : undefined} />)}
      </div>
    </DropdownWrapper>
  </>;
}

export function ComposerReviewComments() {
  const { reviewComments, update, remove } = useComposerContext();
  return <ReviewCommentsAttachment comments={reviewComments}
    onUpdate={(id, comment) => { const item = reviewComments.find((item) => item.id === id); if (item) update({ ...item, comment }); }}
    onRemove={(id) => { const item = reviewComments.find((item) => item.id === id); if (item) remove(item); }} />;
}
