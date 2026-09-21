import type {
  ToolApprovalRequest,
  ToolApprovalResponse,
} from "./runs.dto";

export interface ApprovalNotificationHandle {
  close(): void;
}

export interface RunNotificationSink {
  showApproval(
    request: ToolApprovalRequest,
    handlers: {
      isPending: () => boolean;
      respond: (response: ToolApprovalResponse) => void;
    },
  ): Promise<ApprovalNotificationHandle | null>;
  showFinished(runId: string, status: string): void;
}

let sink: RunNotificationSink | null = null;

/** Desktop installs an Electron sink; a standalone server intentionally has none. */
export function configureRunNotificationSink(
  next: RunNotificationSink | null,
): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

export async function showApprovalNotification(
  request: ToolApprovalRequest,
  handlers: {
    isPending: () => boolean;
    respond: (response: ToolApprovalResponse) => void;
  },
): Promise<ApprovalNotificationHandle | null> {
  return sink?.showApproval(request, handlers) ?? null;
}

export function showRunFinishedNotification(
  runId: string,
  status: string,
): void {
  sink?.showFinished(runId, status);
}

