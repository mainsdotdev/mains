import { SVGProps, ReactElement } from "react";
import type { WorkspaceStatus } from "@/lib/redux/api/workspaceApi";
import StatusBacklog from "./status-backlog";
import StatusTodo from "./status-todo";
import StatusInProgress from "./status-in-progress";
import StatusInReview from "./status-in-review";
import StatusDone from "./status-done";
import StatusCanceled from "./status-canceled";
import StatusDuplicate from "./status-duplicate";

interface WorkspaceStatusIconProps extends SVGProps<SVGSVGElement> {
  status: WorkspaceStatus;
}

const statusIcons: Record<WorkspaceStatus, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  backlog: StatusBacklog,
  todo: StatusTodo,
  in_progress: StatusInProgress,
  in_review: StatusInReview,
  done: StatusDone,
  canceled: StatusCanceled,
  duplicate: StatusDuplicate,
};

export default function WorkspaceStatusIcon({ status, ...props }: WorkspaceStatusIconProps) {
  const Icon = statusIcons[status] ?? statusIcons.todo;
  return <Icon {...props} />;
}
