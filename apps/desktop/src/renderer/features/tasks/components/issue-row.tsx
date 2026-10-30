import type { IssueStatus } from "@mains/contracts/issue-status";
import { Text } from "@/components/ui";
import { Box } from "@/components/ui/icons";
import type { IssueWithEntity } from "@/lib/redux/api";
import { labelColor, parseLabels } from "@/lib/label-colors";
import { ProviderIcon } from "@/features/workspace/components/provider-icon";
import { IssueStatusIcon } from "./issue-status";

/** Labels shown on a row before the rest collapse into "+N". */
const MAX_LABELS = 2;

export const PRIORITY_NAMES = ["No priority", "Urgent", "High", "Medium", "Low"];

/** Provider colors are data; only a plain hex is painted. */
export function plainHex(value: string | null | undefined): string | null {
  return value && /^#[\da-f]{6}$/i.test(value) ? value : null;
}

/** "Oct 19", or "Jan 11 ’19" outside the current year — short enough for one line. */
export function formatIssueDate(value: string | null | undefined, now = new Date()): string | null {
  if (!value) return null;
  // A bare date (a due date, "2025-03-01") is a calendar day, not UTC midnight.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return date.getFullYear() === now.getFullYear()
    ? day
    : `${day} ’${String(date.getFullYear()).slice(-2)}`;
}

/**
 * Linear's priority marks: a filled "!" for urgent, three signal bars that
 * light up for high / medium / low. No priority draws nothing. `decorative`
 * drops the name where text beside the mark already says it.
 */
export function PriorityIcon({ priority, decorative = false }: { priority: number; decorative?: boolean }) {
  if (priority < 1 || priority > 4) return null;
  const label = PRIORITY_NAMES[priority];
  const naming = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  const title = decorative ? null : <title>{label}</title>;
  if (priority === 1) {
    return (
      <svg viewBox="0 0 14 14" {...naming} className="size-3.5 shrink-0 text-warning">
        {title}
        <path
          fillRule="evenodd"
          fill="currentColor"
          d="M3 1h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm3.25 2.5v4.5h1.5V3.5zm0 5.75v1.5h1.5v-1.5z"
        />
      </svg>
    );
  }
  // High lights all three bars, medium two, low one.
  const lit = 5 - priority;
  return (
    <svg viewBox="0 0 14 14" {...naming} className="size-3.5 shrink-0 text-primary-700 dark:text-primary-300">
      {title}
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={1.5 + bar * 4}
          y={9 - bar * 3}
          width="3"
          height={4 + bar * 3}
          rx="0.75"
          fill="currentColor"
          opacity={bar < lit ? 1 : 0.3}
        />
      ))}
    </svg>
  );
}

/**
 * A project / milestone / epic: a cube in the group's color, so it never
 * reads as one more label (those carry a dot).
 */
export function GroupIcon({ color }: { color: string | null }) {
  return (
    <Box
      aria-hidden
      className={`size-3 shrink-0 ${color ? "" : "text-primary-500"}`}
      style={color ? { color } : undefined}
    />
  );
}

export function Pill({
  color,
  icon,
  children,
  title,
}: {
  color?: string | null;
  /** Drawn in place of the color dot. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex max-w-40 shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 glass-outline-soft glass-outline"
    >
      {icon ??
        (color && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />)}
      <Text as="span" size="xxs" tone="secondary" className="truncate">
        {children}
      </Text>
    </span>
  );
}

/**
 * One issue in the Tasks inbox, laid out like Linear's list:
 * priority · status · title … labels · group · date.
 * Every provider fills what it has (`issues` row fields); the rest is
 * simply not drawn. Identifier and assignee aren't drawn either — search
 * finds the one, the filter menu narrows by the other.
 */
export function IssueRow({
  row,
  status,
  isActive,
  showProvider,
  showPriority,
  onClick,
}: {
  row: IssueWithEntity;
  status: IssueStatus | null;
  isActive: boolean;
  /** In a mixed list, which connection the issue is from. */
  showProvider: boolean;
  /** Keeps statuses aligned when any row has a priority. */
  showPriority: boolean;
  onClick: () => void;
}) {
  const { issue, entity } = row;
  const title = entity.title || `Issue ${issue.identifier ?? `#${issue.number ?? "?"}`}`;
  const labels = parseLabels(issue.labels);
  const shown = labels.slice(0, MAX_LABELS);
  const hidden = labels.slice(MAX_LABELS);
  const date = formatIssueDate(entity.occurredAt);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={isActive ? "true" : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={`@container w-full cursor-pointer rounded-2xl px-3 py-2 text-left transition-all duration-200 ease-out ${
        isActive
          ? "bg-primary/80 glass-outline dark:bg-primary/5"
          : "bg-transparent hover:bg-primary/20 dark:hover:bg-primary/5"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {showProvider && (
          <ProviderIcon
            provider={issue.provider}
            className="size-4 shrink-0 text-primary-800 dark:text-primary-200"
          />
        )}
        {showPriority && (
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <PriorityIcon priority={issue.priority} />
          </span>
        )}
        {status && (
          <span title={status.name} aria-label={status.name} role="img" className="flex shrink-0">
            <IssueStatusIcon status={status} />
          </span>
        )}
        <Text as="span" size="s" weight="medium" className="min-w-0 flex-1 truncate">
          {title}
        </Text>

        {/* Labels and group only once the row has room for them. */}
        <span className="hidden shrink-0 items-center gap-1.5 @xl:flex">
          {shown.map((label) => (
            <Pill key={label} color={labelColor(label)}>
              {label}
            </Pill>
          ))}
          {hidden.length > 0 && <Pill title={hidden.join(", ")}>+{hidden.length}</Pill>}
          {issue.groupName && (
            <Pill icon={<GroupIcon color={plainHex(issue.groupColor)} />}>{issue.groupName}</Pill>
          )}
        </span>
        {date && (
          <Text as="span" size="xs" tone="subtle" className="min-w-18 shrink-0 whitespace-nowrap text-right tabular-nums">
            {date}
          </Text>
        )}
      </div>
    </div>
  );
}
