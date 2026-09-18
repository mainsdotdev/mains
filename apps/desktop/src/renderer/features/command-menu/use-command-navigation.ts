import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { GlobalSearchResult } from "@mains/contracts/search";
import type { ModeId } from "@mains/contracts/modes";
import { toast } from "@/components/ui";
import { useActiveSpace } from "@/hooks/use-active-space";
import {
  useSetActiveSpaceMutation,
  useUpdateSpaceMutation,
} from "@/lib/redux/api";
import { useAppDispatch } from "@/lib/redux/hooks";
import {
  openNewRunTab,
  setPendingRunId,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { WORKSPACE_BASE_PATH } from "@/lib/route-utils";
import { resolveRunSpaceTarget } from "@/features/workspace/lib/background-runs";

export function useCommandNavigation() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { activeSpace, activeSpaceId, spaces } = useActiveSpace();
  const [setActiveSpace] = useSetActiveSpaceMutation();
  const [updateSpace] = useUpdateSpaceMutation();

  const openWorkspace = useCallback(
    async (workspaceId: string) => {
      const targetSpace = activeSpace ?? spaces[0];
      if (!targetSpace) {
        toast.error("Set up an agent before opening a workspace");
        return false;
      }

      try {
        if (targetSpace.mode !== "developer" || targetSpace.id !== activeSpaceId) {
          navigate("/", { replace: true });
          if (targetSpace.mode !== "developer") {
            await updateSpace({
              id: targetSpace.id,
              payload: { mode: "developer" },
            }).unwrap();
          }
          if (targetSpace.id !== activeSpaceId) {
            await setActiveSpace(targetSpace.id).unwrap();
          }
        }
        navigate(`${WORKSPACE_BASE_PATH}/${workspaceId}`);
        return true;
      } catch (error) {
        console.error("Failed to open workspace from command menu:", error);
        toast.error("Failed to open workspace");
        return false;
      }
    }, [activeSpace, activeSpaceId, spaces, navigate, setActiveSpace, updateSpace],
  );

  const openRun = useCallback(
    async (result: GlobalSearchResult) => {
      if (!result.runId || !result.providerId || !result.mode) {
        toast.error("This chat is missing its agent context");
        return false;
      }

      const target = resolveRunSpaceTarget(
        {
          spaceId: result.spaceId,
          providerId: result.providerId,
          mode: result.mode,
        },
        spaces,
        activeSpaceId || null,
      );
      if (!target) {
        toast.error("No space is set up for this chat's agent");
        return false;
      }

      try {
        const needsSpaceSwitch = target.spaceId !== activeSpaceId;
        if (needsSpaceSwitch || target.modeSwitch) {
          navigate("/", { replace: true });
          if (target.modeSwitch) {
            await updateSpace({
              id: target.spaceId,
              payload: { mode: target.modeSwitch },
            }).unwrap();
          }
          if (needsSpaceSwitch) await setActiveSpace(target.spaceId).unwrap();
        }

        dispatch(setSelectedCollectionId(result.collectionId));
        dispatch(setPendingRunId(result.runId));
        navigate(
          result.mode === "developer" && result.workspaceId
            ? `${WORKSPACE_BASE_PATH}/${result.workspaceId}`
            : `${WORKSPACE_BASE_PATH}/runs/${result.runId}`,
        );
        return true;
      } catch (error) {
        console.error("Failed to open chat from command menu:", error);
        toast.error("Failed to switch space");
        return false;
      }
    }, [activeSpaceId, spaces, dispatch, navigate, setActiveSpace, updateSpace],
  );

  const newChat = useCallback(() => {
    dispatch(setSelectedCollectionId(null));
    navigate(WORKSPACE_BASE_PATH);
    dispatch(openNewRunTab());
  }, [dispatch, navigate]);

  const switchMode = useCallback(
    async (mode: ModeId) => {
      if (!activeSpace || activeSpace.mode === mode) return;
      try {
        await updateSpace({ id: activeSpace.id, payload: { mode } }).unwrap();
        navigate(WORKSPACE_BASE_PATH);
      } catch (error) {
        console.error("Failed to switch mode from command menu:", error);
        toast.error("Failed to switch mode");
      }
    }, [activeSpace, navigate, updateSpace],
  );

  return { newChat, openRun, openWorkspace, switchMode };
}
