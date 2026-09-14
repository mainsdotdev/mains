import { PullRequest } from "@/components/ui/icons";
import { Button, Text } from "@/components/ui";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { formatDate } from "@/lib/format-date";
import type { PullRequestSummary } from "@/lib/redux/api";

const STATE_CLASSES: Record<string, string> = {
  open: "text-success",
  merged: "text-purple-600 dark:text-purple-400",
  closed: "text-danger",
};

const CI_DOT_CLASSES: Record<string, string> = {
  passing: "bg-success",
  failing: "bg-danger",
  pending: "bg-warning",
};

interface PrListItemProps {
  pr: PullRequestSummary;
  onClick: () => void;
  isActive?: boolean;
  /** Narrow-column mode (detail pane open): drop stats/time/avatar. */
  compact?: boolean;
}

export function PrListItem({
  pr,
  onClick,
  isActive = false,
  compact = false,
}: PrListItemProps) {
  const stateClass = pr.isDraft
    ? "text-primary-600 dark:text-primary-400"
    : (STATE_CLASSES[pr.state] ?? STATE_CLASSES.open);
  const ciDot = CI_DOT_CLASSES[pr.ciStatus];
  const avatarSrc = proxiedImageSrc(pr.author?.avatarUrl);

  return (
    <Button
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded-2xl cursor-pointer transition-all duration-200 ease-out flex items-center gap-2.5 group ${
        isActive
          ? "bg-primary-50 dark:bg-primary/5 glass-outline"
          : "bg-transparent hover:bg-primary/20 dark:hover:bg-primary/5"
      }`}
    >
      {/* State icon with CI dot */}
      <span className="relative shrink-0 inline-flex items-center justify-center">
        <PullRequest className={`w-4.5 h-4.5 ${stateClass}`} />
        {ciDot && (
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${ciDot}`}
          />
        )}
      </span>

      {/* Title + repo/branch line */}
      <div className="flex-1 min-w-0 flex gap-1.5 flex-col justify-center">
        <Text as="span" size="s" weight="medium" className="truncate">
          {pr.title}
          <span className="ml-1"> #{pr.number}</span>
          {pr.isDraft && (
            <Text
              as="span"
              size="xxs"
              tone="subtle"
              weight="normal"
              className="ml-1.5"
            >
              Draft
            </Text>
          )}
        </Text>
        <Text
          as="span"
          size="xs"
          tone="muted"
          className="flex items-center gap-1.5 min-w-0"
        >
          {avatarSrc && (
            <img
              src={avatarSrc}
              alt={pr.author?.login ?? "author"}
              title={pr.author?.login}
              className="size-4 rounded-full shrink-0"
            />
          )}
          <span className="truncate">
            {pr.repo.owner}/{pr.repo.repo}
            <span className="mx-1">·</span>
            {pr.headRefName}
          </span>
        </Text>
      </div>

      {/* Diff stats + time (author avatar lives on the meta line) */}
      <div
        className={`shrink-0 items-center gap-2.5 ${compact ? "hidden" : "flex"}`}
      >
        <Text
          as="span"
          size="xxs"
          tone="inherit"
          className="tabular-nums whitespace-nowrap"
        >
          <Text as="span" size="inherit" tone="success">
            +{pr.additions}
          </Text>{" "}
          <Text as="span" size="inherit" tone="danger">
            -{pr.deletions}
          </Text>
        </Text>
        <Text
          as="span"
          size="xxs"
          tone="muted"
          className="whitespace-nowrap"
        >
          {formatDate(pr.updatedAt)}
        </Text>
      </div>
    </Button>
  );
}
