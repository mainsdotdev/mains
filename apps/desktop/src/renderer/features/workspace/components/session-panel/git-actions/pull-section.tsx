import { useCallback } from "react";
import { ArrowUp } from "@/components/ui/icons";
import { toast } from "@/components/ui";
import { usePullGitFlowMutation } from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { PanelItem } from "../panel-item";
import type { GitActionsPanel } from "./use-git-actions-panel";

/**
 * Fast-forward the checked-out branch from its upstream.
 *
 * The one row in this panel that opens nothing: a pull takes no input, so a
 * form would be a step between the click and the only thing it can mean. The
 * behind count next to it is whatever the last fetch knew — pulling is how it
 * becomes current, which is why a stale zero never disables the row.
 */
export function PullSection({ panel }: { panel: GitActionsPanel }) {
  const {
    workspaceId,
    behind,
    hasRemote,
    hasUpstream,
    pending,
    setPending,
    busy,
    refreshStatus,
  } = panel;

  const [pullGitFlow] = usePullGitFlowMutation();

  const handlePull = useCallback(async () => {
    if (pending) return;
    setPending("pull");
    const toastId = toast.loading("Pulling…");
    try {
      const result = await pullGitFlow(workspaceId).unwrap();
      toast.success(
        result.received === 0
          ? "Already up to date"
          : `Pulled ${result.received} commit${result.received === 1 ? "" : "s"}`,
        { id: toastId },
      );
      refreshStatus();
    } catch (err) {
      // A pull that can't fast-forward changed nothing, and git's own wording
      // ("Not possible to fast-forward") is what says so.
      toast.error(extractErrorMessage(err, "Pull failed"), { id: toastId });
    } finally {
      setPending(null);
    }
  }, [workspaceId, pending, setPending, pullGitFlow, refreshStatus]);

  return (
    <PanelItem
      icon={<ArrowUp className="size-4 rotate-180" />}
      label="Pull"
      trailing={behind > 0 ? `↓${behind}` : undefined}
      onClick={handlePull}
      disabled={busy || !hasUpstream}
      loading={pending === "pull"}
      title={
        !hasRemote
          ? "This repository has no remote."
          : !hasUpstream
            ? "This branch isn't on the remote yet — push it first."
            : "Fetch and fast-forward from the remote"
      }
    />
  );
}
