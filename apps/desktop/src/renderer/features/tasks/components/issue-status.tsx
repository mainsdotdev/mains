import type { IssueStatus } from "@mains/contracts/issue-status";

/**
 * A status's mark, Linear-style: an empty ring fills up as the work moves on.
 * Statuses without their own mark (user-made ones, later) fall back on their
 * category.
 */
const MARKS: Record<string, { className: string; inner?: string; dashed?: boolean; glyph?: string }> = {
  backlog: { className: "text-primary-400", dashed: true },
  todo: { className: "text-primary-500" },
  in_progress: { className: "text-warning", inner: "M7 7V4a3 3 0 0 1 0 6z" },
  in_review: { className: "text-accent", inner: "M7 7V4a3 3 0 1 1-3 3z" },
  done: { className: "text-success", glyph: "M4.5 7.2l1.7 1.7 3.4-3.6" },
  canceled: { className: "text-primary-400", glyph: "M5 5l4 4M9 5l-4 4" },
};

export function IssueStatusIcon({ status, className = "" }: { status: IssueStatus; className?: string }) {
  const mark = MARKS[status.id] ?? MARKS[status.category === "closed" ? "done" : "todo"];
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className={`size-3.5 shrink-0 ${mark.className} ${className}`}
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={mark.dashed ? "2 1.6" : undefined}
      />
      {mark.inner && <path d={mark.inner} fill="currentColor" />}
      {mark.glyph && (
        <path d={mark.glyph} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
