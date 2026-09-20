/**
 * What a chat (a work/chat run) can have done to it, wherever it is listed:
 * the sidebar row's ⋯ menu and the header menu over the open chat. One home so
 * the two cannot drift — the sidebar's Archive and the header's Archive have
 * to mean the same thing, down to the toast and the tab they leave behind.
 *
 * Confirmation is deliberately not here. `deleteChat` deletes; whether a dialog
 * comes first is the caller's business, because each menu anchors its own.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/ui";
import { appApi } from "@/lib/transport";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import {
  useArchiveRunMutation,
  useDeleteRunMutation,
  useGetAccountQuery,
  useLazyGetRunTurnsQuery,
  useMoveRunToCollectionMutation,
  useSetRunPinnedMutation,
  useUpdateRunMutation,
  type Run,
} from "@/lib/redux/api";
import {
  openNewRunTab,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { WORKSPACE_BASE_PATH } from "@/lib/route-utils";
import { useJumpToRun } from "./use-jump-to-run";

/**
 * What a fork is told to do. A fork resumes the provider session, so it needs
 * a prompt — this is the neutral one the transcript's fork button sends too.
 */
const FORK_MESSAGE = "Continue from where this session left off.";

export interface ChatActions {
  renameChat: (run: Run, title: string) => Promise<void>;
  toggleChatPin: (run: Run) => Promise<void>;
  moveChat: (run: Run, collectionId: string | null) => Promise<void>;
  /** Resumes the session in a new chat and opens it. */
  forkChat: (run: Run) => Promise<void>;
  /** The last answer the agent gave, onto the clipboard. */
  copyLastMessage: (run: Run) => Promise<void>;
  /** Reversible: restorable from Settings → Archive. */
  archiveChat: (run: Run) => Promise<void>;
  /** Permanent, and unconfirmed — the caller asks first. */
  deleteChat: (run: Run) => Promise<void>;
}

export function useChatActions(): ChatActions {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const activeTab = useAppSelector((state) => state.workspace.activeTab);
  const { data: account } = useGetAccountQuery();
  const jumpToRun = useJumpToRun();
  const { copy } = useCopyToClipboard();
  const [updateRun] = useUpdateRunMutation();
  const [setRunPinned] = useSetRunPinnedMutation();
  const [moveRunToCollection] = useMoveRunToCollectionMutation();
  const [archiveRun] = useArchiveRunMutation();
  const [deleteRun] = useDeleteRunMutation();
  const [fetchRunTurns] = useLazyGetRunTurnsQuery();

  /** The open tab cannot survive its run leaving the list — send it home. */
  const leaveIfActive = useCallback(
    (runId: string) => {
      if (activeTab !== runId) return;
      navigate(WORKSPACE_BASE_PATH);
      dispatch(openNewRunTab());
    },
    [activeTab, dispatch, navigate],
  );

  const renameChat = useCallback(
    async (run: Run, title: string) => {
      const next = title.trim();
      if (!next) return;
      try {
        await updateRun({ id: run.id, payload: { title: next } }).unwrap();
      } catch (error) {
        console.error("Failed to rename chat:", error);
        toast.error("Failed to rename chat");
      }
    },
    [updateRun],
  );

  const toggleChatPin = useCallback(
    async (run: Run) => {
      if (!account) return;
      const pinned = !run.pinnedAt;
      try {
        await setRunPinned({
          runId: run.id,
          accountId: account.id,
          pinned,
        }).unwrap();
      } catch (error) {
        console.error("Failed to pin chat:", error);
        toast.error(pinned ? "Failed to pin chat" : "Failed to unpin chat");
      }
    },
    [account, setRunPinned],
  );

  const moveChat = useCallback(
    async (run: Run, collectionId: string | null) => {
      if (!account) return;
      try {
        await moveRunToCollection({
          runId: run.id,
          accountId: account.id,
          collectionId,
        }).unwrap();
        if (activeTab === run.id) {
          dispatch(setSelectedCollectionId(collectionId));
        }
      } catch (error) {
        console.error("Failed to move chat:", error);
        toast.error("Failed to move chat");
      }
    },
    [account, activeTab, dispatch, moveRunToCollection],
  );

  const forkChat = useCallback(
    async (run: Run) => {
      if (!account) return;
      try {
        const result = await appApi.runs.fork({
          sourceRunId: run.id,
          accountId: account.id,
          message: FORK_MESSAGE,
        });
        if (!result.success) {
          throw new Error(result.error || "Failed to fork chat");
        }
        // A fork keeps its source's space, mode, and project, so the jump
        // target is the source run wearing the new id.
        await jumpToRun({ ...run, id: result.data.runId });
      } catch (error) {
        console.error("Failed to fork chat:", error);
        toast.error("Failed to fork chat");
      }
    },
    [account, jumpToRun],
  );

  const copyLastMessage = useCallback(
    async (run: Run) => {
      try {
        const turns = await fetchRunTurns(run.id).unwrap();
        // Backwards: the newest turn that actually answered. A turn can end
        // with no prose at all (a tool call, an aborted run), and the useful
        // message is then the one before it.
        const answered = [...turns]
          .reverse()
          .find((turn) => turn.responseContent?.trim());
        if (!answered?.responseContent) {
          toast.error("This chat has no message to copy");
          return;
        }
        // The menu closes on click and the clipboard is invisible, so the
        // toast is the only sign the copy happened.
        if (await copy(answered.responseContent)) {
          toast.success("Message copied");
        } else {
          toast.error("Failed to copy message");
        }
      } catch (error) {
        console.error("Failed to copy message:", error);
        toast.error("Failed to copy message");
      }
    },
    [copy, fetchRunTurns],
  );

  const archiveChat = useCallback(
    async (run: Run) => {
      try {
        await archiveRun(run.id).unwrap();
        leaveIfActive(run.id);
      } catch (error) {
        console.error("Failed to archive chat:", error);
        toast.error("Failed to archive chat");
      }
    },
    [archiveRun, leaveIfActive],
  );

  const deleteChat = useCallback(
    async (run: Run) => {
      try {
        await deleteRun(run.id).unwrap();
        leaveIfActive(run.id);
      } catch (error) {
        console.error("Failed to delete chat:", error);
        toast.error("Failed to delete chat");
        throw error;
      }
    },
    [deleteRun, leaveIfActive],
  );

  return {
    renameChat,
    toggleChatPin,
    moveChat,
    forkChat,
    copyLastMessage,
    archiveChat,
    deleteChat,
  };
}
