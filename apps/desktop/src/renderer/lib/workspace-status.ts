import type { WorkspaceStatus } from "@/lib/redux/api/workspaceApi";

interface WorkspaceStatusConfig {
  label: string;
  color: string;
  iconColor: string;
}

const statusConfig: Record<WorkspaceStatus, WorkspaceStatusConfig> = {
  backlog: {
    label: "Backlog",
    color: "text-primary-600 dark:text-primary-400",
    iconColor: "text-primary-800 dark:text-primary-200",
  },
  todo: {
    label: "Todo",
    color: "text-accent",
    iconColor: "text-primary-800 dark:text-primary-200",
  },
  in_progress: {
    label: "In Progress",
    color: "text-warning",
    iconColor: "text-warning",
  },
  in_review: {
    label: "In Review",
    color: "text-success",
    iconColor: "text-success",
  },
  done: {
    label: "Done",
    color: "text-accent",
    iconColor: "text-accent",
  },
  canceled: {
    label: "Canceled",
    color: "text-danger",
    iconColor: "text-danger",
  },
  duplicate: {
    label: "Duplicate",
    color: "text-primary-600 dark:text-primary-400",
    iconColor: "text-primary-600 dark:text-primary-400",
  },
};

export function getWorkspaceStatusConfig(status: WorkspaceStatus): WorkspaceStatusConfig {
  return statusConfig[status] ?? statusConfig.todo;
}
