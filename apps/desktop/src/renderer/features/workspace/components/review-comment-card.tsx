import { useState } from "react";
import type { ReviewComment } from "@mains/contracts/review-comments";
import { Button, Textarea } from "@/components/ui";
import { Edit, Trash } from "@/components/ui/icons";

const actionClass = "rounded-lg p-1 text-primary-500 hover:text-primary-900 dark:hover:text-primary-100";

export function ReviewCommentEditor({ initialValue = "", onSave, onCancel }: {
  initialValue?: string;
  onSave: (comment: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  const save = () => { if (draft.trim()) onSave(draft.trim()); };
  return <div className="space-y-2">
    <Textarea autoFocus rows={2} maxLength={4000} value={draft}
      aria-label="Review comment" placeholder="Add a comment…"
      className="text-xs"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); save(); }
      }} />
    <div className="flex justify-end gap-2">
      <Button type="button" onClick={onCancel} className={`${actionClass} px-2 text-xs`}>Cancel</Button>
      <Button variant="submit" type="button" disabled={!draft.trim()} onClick={save}
        className=" ">Save comment</Button>
    </div>
  </div>;
}

export function ReviewCommentCard({ comment, onUpdate, onRemove }: {
  comment: ReviewComment;
  onUpdate?: (text: string) => void;
  onRemove?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const line = `${comment.side === "deletions" ? "L" : "R"}${comment.lineNumber}`;
  return <article className="glass-card min-w-0 rounded-2xl p-3 font-sans text-xs">
    <div className="mb-2 flex items-center gap-2">
      <span title={comment.filePath} className="min-w-0 flex-1 truncate text-primary-500">{comment.filePath} · {line}</span>
      {onUpdate && <Button type="button" aria-label={`Edit comment on ${line}`} onClick={() => setEditing(true)} className={actionClass}><Edit className="size-3.5" /></Button>}
      {onRemove && <Button type="button" aria-label={`Delete comment on ${line}`} onClick={onRemove} className={actionClass}><Trash className="size-3.5" /></Button>}
    </div>
    <pre className="mb-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-primary/40 px-2 py-1.5 font-mono text-primary-600 dark:bg-primary-950/50 dark:text-primary-400">{comment.lineText || "(empty line)"}</pre>
    {editing && onUpdate ? <ReviewCommentEditor initialValue={comment.comment} onCancel={() => setEditing(false)}
      onSave={(text) => { onUpdate(text); setEditing(false); }} />
      : <p className="whitespace-pre-wrap wrap-break-word text-primary-900 dark:text-primary-100">{comment.comment}</p>}
  </article>;
}
