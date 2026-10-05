/**
 * Accept the three shapes a timestamp reaches the renderer as: a Date that
 * survived structured clone over IPC, a unix timestamp (seconds from SQLite,
 * milliseconds from JS), or an ISO string.
 */
function toDate(date: string | number | Date): Date {
  if (date instanceof Date) return date;
  if (typeof date === "number") {
    return new Date(date < 1e12 ? date * 1000 : date);
  }
  return new Date(date);
}

/** Compact elapsed time for small metadata labels: now, 7m, 2h, 1d, 1w. */
export function formatCompactRelativeDate(
  date: string | number | Date,
  now = Date.now(),
): string {
  const elapsed = Math.max(0, now - toDate(date).getTime());
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function formatDate(date: string | number | Date): string {
  const now = new Date();
  const past = toDate(date);
  const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return `just now`;
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) {
    return `${diffInDays}d ago`;
  }

  return past.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * An exact timestamp — "Jun 16. 2026. 10:03 AM".
 *
 * For places where "6m ago" is the wrong answer because the user is deciding
 * about an old record and wants to know when, not how long ago. Assembled from
 * parts rather than a single toLocaleString: no locale produces this
 * period-separated shape, and `dateStyle`/`timeStyle` would join with "at".
 */
export function formatAbsoluteDate(date: string | number | Date): string {
  const value = toDate(date);
  const month = value.toLocaleString("en-US", { month: "short" });
  const time = value.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${month} ${value.getDate()}, ${value.getFullYear()}, ${time}`;
}
