import { Text, Tooltip } from "@/components/ui";
import type {
  ContextUsageCategory,
  ContextUsageSnapshot,
} from "../hooks/use-context-usage";


interface ContextUsageRingProps {
  usage: ContextUsageSnapshot | null;
}

type Tone = "normal" | "warn" | "critical";

/** Arc / bar / number colors keyed by fill severity, so the ring and the
 *  tooltip always read as the same state. */
const TONE = {
  normal: {
    stroke: "stroke-primary-500 dark:stroke-primary-300",
    fill: "bg-primary-500 dark:bg-primary-300",
    text: "text-primary-700 dark:text-primary-300",
  },
  warn: {
    stroke: "stroke-warning",
    fill: "bg-warning",
    text: "text-warning",
  },
  critical: {
    stroke: "stroke-danger",
    fill: "bg-danger",
    text: "text-danger",
  },
} satisfies Record<Tone, { stroke: string; fill: string; text: string }>;

/**
 * Categorical slots, in the fixed order validated in index.css. A run with more
 * categories than this does NOT get a generated sixth hue — the tail folds into
 * one neutral "Other" row, which is the only safe way to end the ramp.
 */
const SLOT_COLORS = [
  "var(--viz-cat-1)",
  "var(--viz-cat-2)",
  "var(--viz-cat-3)",
  "var(--viz-cat-4)",
  "var(--viz-cat-5)",
];

/** Empty-space fills. Not identity colors — they read as surface, not series. */
const TRACK_CLASS = "bg-primary-200/70 dark:bg-primary-800";
const BUFFER_CLASS = "bg-primary-300/70 dark:bg-primary-700";

export interface ContextBreakdownRow {
  key: string;
  label: string;
  tokens: number;
  /** Series color for an identity row; undefined for empty space. */
  color?: string;
  /** Fill class for a row that wears a surface tone instead of a hue. */
  className?: string;
  /** Floor in px, for a segment that must stay visible however small it is. */
  minWidth?: number;
}

/**
 * Fold a provider's category partition into the rows the bar and the legend
 * both render.
 *
 * `deferred` rows are dropped: the provider excludes them from the usage math
 * (they are out-of-window tool schemas), so showing them inside a bar that
 * represents the window would misstate what is occupying it.
 */
export function buildContextBreakdown(
  categories: ContextUsageCategory[] | undefined,
): ContextBreakdownRow[] {
  if (!categories?.length) return [];

  const named: (ContextBreakdownRow & { slot: number })[] = [];
  let otherTokens = 0;
  let bufferTokens = 0;
  let freeTokens = 0;

  for (const category of categories) {
    if (category.tokens <= 0) continue;
    if (category.kind === "buffer") bufferTokens += category.tokens;
    else if (category.kind === "free") freeTokens += category.tokens;
    else if (category.kind === "used") {
      if (category.slot >= 0 && category.slot < SLOT_COLORS.length) {
        named.push({
          key: category.name,
          label: category.name,
          tokens: category.tokens,
          color: SLOT_COLORS[category.slot],
          slot: category.slot,
        });
      } else {
        otherTokens += category.tokens;
      }
    }
  }

  if (!named.length && !otherTokens) return [];

  // Identity rows stay in slot order so a category holds its position as it
  // grows; empty space always trails the content it is left over from.
  named.sort((a, b) => a.slot - b.slot);

  const rows: ContextBreakdownRow[] = named.map(({ slot: _slot, ...row }) => row);
  if (otherTokens > 0) {
    rows.push({
      key: "__other",
      label: "Other",
      tokens: otherTokens,
      className: "bg-primary-400 dark:bg-primary-500",
    });
  }
  if (bufferTokens > 0) {
    rows.push({
      key: "__buffer",
      label: "Compaction buffer",
      tokens: bufferTokens,
      className: BUFFER_CLASS,
    });
  }
  if (freeTokens > 0) {
    rows.push({
      key: "__free",
      label: "Free",
      tokens: freeTokens,
      className: TRACK_CLASS,
    });
  }
  return rows;
}

function MetricRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <Text as="span" size="inherit" tone="subtle">{label}</Text>
      <Text
        as="span"
        size="inherit"
        tone={emphasis ? "default" : "subtle"}
        weight={emphasis ? "medium" : undefined}
        className="tabular-nums"
      >
        {value}
      </Text>
    </div>
  );
}

/**
 * One row of the breakdown: a swatch carrying the identity, then the name and
 * the token count as plain text. The text never wears the series color — a
 * light categorical hue is illegible as type, and the light steps sit under 3:1
 * on the surface, so the visible label is also what makes the swatch legal.
 */
function LegendRow({ row }: { row: ContextBreakdownRow }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-[2px] ${row.className ?? ""}`}
          style={row.color ? { background: row.color } : undefined}
        />
        <Text as="span" size="inherit" tone="subtle" className="truncate">
          {row.label}
        </Text>
      </span>
      <Text as="span" size="inherit" tone="subtle" className="shrink-0 tabular-nums">
        {row.tokens.toLocaleString()}
      </Text>
    </div>
  );
}

/**
 * Circular context-window indicator. The colored arc is the used portion, the
 * muted track is what remains. Hovering (or focusing) reveals the breakdown.
 * Turns amber near the auto-compact threshold and red once the window is nearly
 * full.
 */
export function ContextUsageRing({ usage }: ContextUsageRingProps) {
  if (!usage || !usage.maxTokens) return null;

  const pct = Math.max(0, Math.min(100, usage.percentage));
  const used = Math.min(usage.totalTokens, usage.maxTokens);
  const remaining = Math.max(0, usage.maxTokens - used);
  const rows = buildContextBreakdown(usage.categories);

  const thresholdPct =
    usage.isAutoCompactEnabled && usage.autoCompactThreshold && usage.maxTokens
      ? (usage.autoCompactThreshold / usage.maxTokens) * 100
      : undefined;

  const tone: Tone =
    pct >= 90
      ? "critical"
      : thresholdPct != null && pct >= thresholdPct
        ? "warn"
        : "normal";
  const { stroke: arcClass, fill: barClass, text: toneText } = TONE[tone];

  // With a breakdown the bar is the partition itself; without one it falls back
  // to a single tone-colored fill against the track.
  // A share this small cannot render wider than the gap beside it. Padding it to
  // a minimum would draw a 90-token category the same width as a 2,000-token one,
  // so it leaves the bar entirely — the legend below still carries its number.
  // The two-segment fallback has no legend to fall back on, so it keeps a floor
  // instead and shows a sliver of fill from the very first tokens.
  const segmentTotal = rows.reduce((sum, row) => sum + row.tokens, 0);
  const segments: ContextBreakdownRow[] = rows.length
    ? rows.filter((row) => segmentTotal > 0 && row.tokens / segmentTotal >= 0.01)
    : [
        { key: "__used", label: "Used", tokens: used, className: barClass, minWidth: 4 },
        { key: "__free", label: "Free", tokens: remaining, className: TRACK_CLASS },
      ].filter((segment) => segment.tokens > 0);

  const size = 27;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (circumference * pct) / 100;

  const largest = rows.find((row) => row.color);
  const label =
    `Context window ${pct.toFixed(0)}% used` +
    (largest ? `, largest: ${largest.label} ${largest.tokens.toLocaleString()} tokens` : "");

  const tooltip = (
    <Text as="div" size="xs" tone="inherit" className="flex w-56 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Text as="span" size="t" tone="subtle" weight="medium" className="uppercase tracking-wider">
          Context window
        </Text>
        <span className={`text-s font-semibold tabular-nums ${toneText}`}>
          {pct.toFixed(0)}%
        </span>
      </div>

      {/* No background of its own: the 2px gaps between segments are meant to
          read as surface, which is what separates touching fills. */}
      <div className="relative flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={`h-full transition-[flex-grow] duration-300 ${segment.className ?? ""}`}
            style={{
              flexGrow: segment.tokens,
              flexBasis: 0,
              minWidth: segment.minWidth,
              ...(segment.color ? { background: segment.color } : {}),
            }}
          />
        ))}
        {thresholdPct != null && (
          <span
            className="absolute inset-y-0 w-px bg-primary-950/30 dark:bg-primary-100/40"
            style={{ left: `${Math.min(thresholdPct, 100)}%` }}
          />
        )}
      </div>

      {rows.length > 0 ? (
        <div className="flex flex-col gap-1">
          {rows.map((row) => (
            <LegendRow key={row.key} row={row} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <MetricRow label="Used" value={used.toLocaleString()} emphasis />
          <MetricRow label="Remaining" value={remaining.toLocaleString()} />
          <MetricRow label="Total" value={usage.maxTokens.toLocaleString()} />
        </div>
      )}

      {(usage.model || thresholdPct != null || rows.length > 0) && (
        <Text as="div" size="xxs" tone="subtle" className="flex items-center justify-between gap-3 border-t border-primary-950/10 pt-1.5 dark:border-primary-100/10">
          {usage.model && <span className="min-w-0 truncate">{usage.model}</span>}
          {thresholdPct != null ? (
            <span className="shrink-0 tabular-nums">
              compacts at {thresholdPct.toFixed(0)}%
            </span>
          ) : (
            rows.length > 0 && (
              <span className="shrink-0 tabular-nums">
                {usage.maxTokens.toLocaleString()} total
              </span>
            )
          )}
        </Text>
      )}
    </Text>
  );

  return (
    <Tooltip position="top-left" content={tooltip} className="p-2.5 rounded-xl">
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
        role="meter"
        tabIndex={0}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-primary-200/70 dark:stroke-primary-800"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className={`${arcClass} transition-[stroke-dasharray] duration-300`}
          />
        </svg>
        <Text as="span" size="xxs" tone="subtle" weight="medium" className="absolute tabular-nums">
          {pct.toFixed(0)}
        </Text>
      </div>
    </Tooltip>
  );
}
