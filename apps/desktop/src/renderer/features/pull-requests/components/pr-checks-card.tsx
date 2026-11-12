import { useEffect, useId, useState } from "react";
import type { PrCiStatus, PullRequestDetail } from "@/lib/redux/api/pullRequestsApi";
import { Button, Text } from "@/components/ui";
import { ArrowUp, Check, Close, External } from "@/components/ui/icons";
import { checkDuration } from "../lib/pr-checks";

function CheckStatus({ status }: { status: PrCiStatus }) {
  return <span className={"flex size-4 shrink-0 items-center justify-center rounded-full " + (
    status === "passing" ? "bg-success/15 text-success" : status === "failing" ? "bg-danger/15 text-danger"
      : status === "pending" ? "border-2 border-warning text-warning" : "bg-primary-400/20 text-primary-500"
  )}>
    {status === "passing" ? <Check className="size-2.5" /> : status === "failing" ? <Close className="size-2.5" /> : null}
    <span className="sr-only">{status}</span>
  </span>;
}

export function PrChecksCard({ detail, active }: { detail: PullRequestDetail; active: boolean }) {
  const id = useId();
  const [expanded, setExpanded] = useState(detail.ciStatus === "pending" || detail.ciStatus === "failing");
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(Date.now);
  const checks = detail.checks;
  const running = checks.some((check) => check.status === "pending" && check.startedAt && !check.completedAt);
  useEffect(() => {
    if (!active || !running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, running]);

  const failing = checks.filter((check) => check.status === "failing").length;
  const pending = checks.filter((check) => check.status === "pending").length;
  const headline = failing > 0 ? `${failing} failing ${failing === 1 ? "check" : "checks"}`
    : pending > 0 ? "Running checks" : checks.length > 0 ? "All checks passed" : "No checks";
  const status = failing > 0 ? "failing" : pending > 0 ? "pending" : checks.length > 0 ? "passing" : "none";
  const reviewers = [...new Set(detail.latestReviews.flatMap((review) => review.author ? [review.author] : []))];
  const reviewLabel = detail.reviewDecision ? detail.reviewDecision.replace(/_/g, " ").toLowerCase() : "No reviews";
  const starts = checks.map((check) => check.startedAt).filter((value): value is string => !!value && Number.isFinite(Date.parse(value))).sort();
  const ends = checks.map((check) => check.completedAt).filter((value): value is string => !!value && Number.isFinite(Date.parse(value))).sort();
  // Queued checks have no duration yet. Completed checks without an end time
  // must not keep counting up after the run has finished.
  const elapsed = starts.length && (running || (ends.length && pending === 0))
    ? checkDuration(starts[0], running ? null : ends[ends.length - 1], now) : null;

  return <section aria-label="Reviews and checks" className="overflow-hidden rounded-2xl bg-primary-100/50 glass-outline dark:bg-primary/3">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3">
      <Text size="xs" tone="secondary" className="capitalize">{reviewLabel}</Text>
      {reviewers.length > 0 && <Text size="xs" tone="subtle" className="wrap-break-word">· {reviewers.join(", ")}</Text>}
    </div>
    <div className="mx-4 border-t border-primary-200/60 dark:border-primary-800/60" />
    <Button variant="bare" disabled={checks.length === 0} aria-expanded={expanded && checks.length > 0} aria-controls={id}
      onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-primary-200/20 dark:enabled:hover:bg-primary/3">
      <CheckStatus status={status} />
      <Text size="s">{headline}</Text>
      {failing > 0 && pending > 0 && <Text size="xs" tone="subtle">· {pending} pending</Text>}
      {elapsed && <Text size="xs" tone="subtle" className="tabular-nums">{elapsed}</Text>}
      {checks.length > 0 && <ArrowUp className={"ml-auto size-3 text-primary-500 " + (expanded ? "" : "rotate-180")} />}
    </Button>
    {expanded && checks.length > 0 && <div id={id} className="px-4 pb-3 pl-11">
      {(showAll ? checks : checks.slice(0, 5)).map((check) => <div key={check.id} className="flex items-center gap-3 py-2">
        <CheckStatus status={check.status} />
        <Text size="xs" tone="secondary" className="min-w-0 flex-1 wrap-break-word">{check.name}</Text>
        {(check.completedAt || check.status === "pending") && <Text size="xxs" tone="subtle" className="shrink-0 tabular-nums">
          {checkDuration(check.startedAt, check.completedAt, now)}
        </Text>}
        {check.url && <Button variant="icon" iconSize="sm" aria-label={`Open ${check.name} check details`}
          onClick={() => { void window.api.shell.openExternal(check.url!); }}><External className="size-3" /></Button>}
      </div>)}
      {checks.length > 5 && <Button variant="subtle" className="mt-1 text-xs text-primary-500" onClick={() => setShowAll((value) => !value)}>
        {showAll ? "Show less" : `Show ${checks.length - 5} more`}
      </Button>}
    </div>}
  </section>;
}
