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
