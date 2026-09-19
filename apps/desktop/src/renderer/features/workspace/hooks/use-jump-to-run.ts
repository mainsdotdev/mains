import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/ui";
import { useActiveSpace } from "@/hooks/use-active-space";
import {
  useSetActiveSpaceMutation,
  useUpdateSpaceMutation,
  type ActiveRun,
} from "@/lib/redux/api";
import { useAppDispatch } from "@/lib/redux/hooks";
import {
  setPendingRunId,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { WORKSPACE_BASE_PATH } from "@/lib/route-utils";
import { resolveRunSpaceTarget } from "../lib/background-runs";

/** What a jump needs to know about a run: where it lives, and under which agent. */
export type RunJumpTarget = Pick<
  ActiveRun,
  "id" | "spaceId" | "providerId" | "mode" | "workspaceId" | "collectionId"
>;

/**
 * Open a run from outside the page it lives on — the background-run dock, or a
 * click on a desktop notification. Puts the run's space (and mode) in front
 * first, then navigates to it.
 */
export function useJumpToRun(): (run: RunJumpTarget) => Promise<void> {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { activeSpaceId, spaces } = useActiveSpace();
  const [setActiveSpace] = useSetActiveSpaceMutation();
  const [updateSpace] = useUpdateSpaceMutation();

  return useCallback(
    async (run: RunJumpTarget) => {
      // The page shows one provider and one mode at a time, so landing on the
      // workspace is only half the jump — without the right space, the run is
      // filtered out of the tab list and the page falls back to the newest one
      // it can show.
      const target = resolveRunSpaceTarget(run, spaces, activeSpaceId || null);
      if (!target) {
        toast.error("No space is set up for this run's agent");
        return;
      }

      dispatch(setPendingRunId(run.id));
      dispatch(setSelectedCollectionId(run.collectionId));

      const needsSpaceSwitch = target.spaceId !== activeSpaceId;
      if (needsSpaceSwitch || target.modeSwitch) {
        try {
          // Same ordering as the space picker: leave `/code/:workspaceId`
          // before switching, so the incoming space's provider never renders
          // against the outgoing space's workspace param.
          navigate("/", { replace: true });
          // A run can be reached from a surface that spans modes, so the jump
          // has to put a space back into the mode its run was started in.
          if (target.modeSwitch) {
            await updateSpace({
              id: target.spaceId,
              payload: { mode: target.modeSwitch },
            }).unwrap();
          }
          if (needsSpaceSwitch) await setActiveSpace(target.spaceId).unwrap();
        } catch (error) {
          console.error("Failed to switch space for run:", error);
          toast.error("Failed to switch space");
          return;
        }
      }

      navigate(
        run.mode === "developer" && run.workspaceId
          ? `${WORKSPACE_BASE_PATH}/${run.workspaceId}`
          : `${WORKSPACE_BASE_PATH}/runs/${run.id}`,
      );
    },
    [activeSpaceId, spaces, dispatch, navigate, setActiveSpace, updateSpace],
  );
}
