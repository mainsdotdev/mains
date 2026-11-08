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
    begin,
    busy,
    refreshStatus,
  } = panel;

  const [pullGitFlow] = usePullGitFlowMutation();

  const handlePull = useCallback(async () => {
    const lease = begin("pull", "");
    if (!lease) return;
    let accepted = false;
    const toastId = toast.loading("Pulling…");
    try {
      const result = await pullGitFlow(workspaceId).unwrap();
      accepted = true;
      if (!lease.current()) return;
      toast.success(
        result.received === 0
          ? "Already up to date"
          : `Pulled ${result.received} commit${result.received === 1 ? "" : "s"}`,
        { id: toastId },
      );
      refreshStatus();
    } catch (err) {
      if (!lease.current()) return;
      // A pull that can't fast-forward changed nothing, and git's own wording
      // ("Not possible to fast-forward") is what says so.
      toast.error(extractErrorMessage(err, "Pull failed"), { id: toastId });
    } finally {
      if (!lease.current()) toast.dismiss(toastId);
      lease.finish(accepted);
    }
  }, [workspaceId, begin, pullGitFlow, refreshStatus]);

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
