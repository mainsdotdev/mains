import type { WorkspaceActivity } from "@/lib/redux/api";
import { fileBasename } from "@/lib/file-path";

/** How loud the row's glyph is. Undone edits recede; findings follow severity. */
export type ActivityIconTone = "default" | "danger" | "warning" | "muted";

/** Where a row click goes. Expand stays on the chevron, separate from this. */
export type ActivityRowAction =
  | { kind: "note"; reviewId: string; title: string; status: string }
  | { kind: "url"; url: string }
  | { kind: "run"; runId: string }
  | { kind: "file"; path: string };

export interface ActivityRowModel {
  title: string;
  /** Full commit id. The row shows a short prefix and copies this. */
  sha: string | null;
  /** One line under the title. Null when the title already says it. */
  subtitle: string | null;
  /** Text the chevron reveals. Null when the subtitle is the whole story. */
  detail: string | null;
  undone: boolean;
  iconTone: ActivityIconTone;
  action: ActivityRowAction | null;
}

/**
 * The timeline row for one workspace activity. File edits, git events, reviews,
 * and findings share one shape so the section only has to place it.
 */
export function activityRow(activity: WorkspaceActivity): ActivityRowModel {
  switch (activity.type) {
    case "diff":
      return diffRow(activity);
    case "review":
      return reviewRow(activity);
    case "finding":
      return findingRow(activity);
    case "commit":
      return commitRow(activity);
    case "pr":
      return prRow(activity);
    case "push":
    case "pull":
      return branchRow(activity);
    default: {
      const unknown: never = activity.type;
      return unknown;
    }
  }
}

export function activityActionLabel(action: ActivityRowAction): string {
  switch (action.kind) {
    case "note":
      return "Open review";
    case "url":
      return "Open pull request";
    case "run":
      return "Open chat";
    case "file":
      return "Open file";
    default: {
      const unknown: never = action;
      return unknown;
    }
  }
}

const ICON_CLASS: Record<ActivityIconTone, string> = {
  default: "text-primary-700 dark:text-primary-300",
  danger: "text-danger",
  warning: "text-warning",
  muted: "text-primary-700/45 dark:text-primary-300/45",
};

export function activityIconClass(tone: ActivityIconTone): string {
  return ICON_CLASS[tone];
}

function diffRow(activity: WorkspaceActivity): ActivityRowModel {
  const meta = metaOf(activity);
  const undone = typeof meta.undoneAt === "number";
  const names = stringList(meta, "fileNames");
  const files = names.length > 0 ? filePreview(names) : prose(activity.summary);
  const title = undone ? `${activity.title} (undone)` : activity.title;
  return {
    title,
    sha: null,
    subtitle: names.length > 0 ? files.subtitle : distinct(files.subtitle, activity.title),
    detail: files.detail,
    undone,
    iconTone: undone ? "muted" : "default",
    action: activity.refId ? { kind: "run", runId: activity.refId } : null,
  };
}

function reviewRow(activity: WorkspaceActivity): ActivityRowModel {
  const body = prose(activity.summary);
  return {
    title: activity.title,
    sha: null,
    subtitle: body.subtitle,
    detail: body.detail,
    undone: false,
    iconTone: "default",
    action: activity.refId
      ? {
          kind: "note",
          reviewId: activity.refId,
          title: activity.title,
          status: text(metaOf(activity), "status") ?? "open",
        }
      : null,
  };
}

function findingRow(activity: WorkspaceActivity): ActivityRowModel {
  const meta = metaOf(activity);
  const batch = positiveNumber(meta, "count");
  const tone = findingTone(meta);
  if (batch) {
    return {
      title: `Mains added ${batch} finding${batch === 1 ? "" : "s"}`,
      sha: null,
      subtitle: severityLine(meta),
      detail: null,
      undone: false,
      iconTone: tone,
      action: null,
    };
  }

  const file = text(meta, "file");
  const line = positiveNumber(meta, "lineStart");
  const body = prose(activity.summary);
  return {
    title: line ? withLine(activity.title, line) : activity.title,
    sha: null,
    subtitle: body.subtitle,
    detail: body.detail,
    undone: false,
    iconTone: tone,
    action: file ? { kind: "file", path: file } : null,
  };
}

function commitRow(activity: WorkspaceActivity): ActivityRowModel {
  return {
    title: "You committed changes",
    sha: activity.refId,
    subtitle: distinct(activity.title.trim() || null, "You committed changes"),
    detail: null,
    undone: false,
    iconTone: "default",
    action: null,
  };
}

function prRow(activity: WorkspaceActivity): ActivityRowModel {
  const meta = metaOf(activity);
  const label = [meta.draft === true ? "Draft" : null, text(meta, "base")]
    .filter((part): part is string => !!part)
    .join(" · ");
  const body = prose(activity.summary);
  const url = httpUrl(activity.refId);
  return {
    title: activity.title,
    sha: null,
    subtitle: label || body.subtitle,
    detail: label ? activity.summary?.trim() || null : body.detail,
    undone: false,
    iconTone: "default",
    action: url ? { kind: "url", url } : null,
  };
}

function branchRow(activity: WorkspaceActivity): ActivityRowModel {
  return {
    title: activity.title,
    sha: null,
    subtitle: text(metaOf(activity), "branch"),
    detail: null,
    undone: false,
    iconTone: "default",
    action: null,
  };
}

function filePreview(names: string[]): { subtitle: string; detail: string | null } {
  const labels = names.map((name) => fileLabel(name, names));
  if (labels.length <= 2) return { subtitle: labels.join(", "), detail: null };
  const more = labels.length - 2;
  return {
    subtitle: `${labels[0]}, ${labels[1]}, and ${more} more`,
    detail: names.join("\n"),
  };
}

/** Basename, unless another file in the same edit shares it — then the parent too. */
function fileLabel(path: string, names: string[]): string {
  const base = fileBasename(path);
  const shared = names.some((name) => name !== path && fileBasename(name) === base);
  if (!shared) return base;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}

function prose(value: string | null): { subtitle: string | null; detail: string | null } {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { subtitle: null, detail: null };
  const first = trimmed.split("\n").map((line) => line.trim()).find(Boolean) ?? trimmed;
  if (trimmed === first) return { subtitle: first, detail: null };
  return { subtitle: first, detail: trimmed };
}

function distinct(subtitle: string | null, title: string): string | null {
  if (!subtitle || subtitle === title) return null;
  return subtitle;
}

function withLine(title: string, line: number): string {
  const suffix = `:${line}`;
  return title.endsWith(suffix) ? title : `${title}${suffix}`;
}

function findingTone(meta: Record<string, unknown>): ActivityIconTone {
  if (positiveNumber(meta, "count")) {
    return toneFromCounts(
      positiveNumber(meta, "critical") ?? 0,
      positiveNumber(meta, "warning") ?? 0,
    );
  }
  const guard = guardTone(meta);
  if (guard) return guard;
  const severity = text(meta, "severity");
  if (severity === "critical" || severity === "high") return "danger";
  if (severity === "warning" || severity === "medium") return "warning";
  return "default";
}

function guardTone(meta: Record<string, unknown>): ActivityIconTone | null {
  const summary = meta.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const record = summary as Record<string, unknown>;
  const critical = (positiveNumber(record, "critical") ?? 0) + (positiveNumber(record, "high") ?? 0);
  const warning = (positiveNumber(record, "medium") ?? 0) + (positiveNumber(record, "warning") ?? 0);
  return toneFromCounts(critical, warning);
}

function toneFromCounts(critical: number, warning: number): ActivityIconTone {
  if (critical > 0) return "danger";
  if (warning > 0) return "warning";
  return "default";
}

function severityLine(meta: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const critical = positiveNumber(meta, "critical");
  const warning = positiveNumber(meta, "warning");
  const info = positiveNumber(meta, "info");
  if (critical) parts.push(`${critical} critical`);
  if (warning) parts.push(`${warning} warning`);
  if (info) parts.push(`${info} info`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function metaOf(activity: WorkspaceActivity): Record<string, unknown> {
  const metadata = activity.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) return metadata;
  return {};
}

function text(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function stringList(meta: Record<string, unknown>, key: string): string[] {
  const value = meta[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    return null;
  }
  return null;
}
