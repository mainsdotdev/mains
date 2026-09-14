/**
 * The five ways a run gets started or extended — execute, continue, fork,
 * review, and the resume probe that gates continue.
 *
 * They share one shape: validate the input, project the composer's context onto
 * a payload, call the API behind `runOperation` (which owns the in-flight flag,
 * the account lookup, and the error toast), then hand the result back to the run
 * list. That shape is why they live together, away from the loading and
 * live-sync machinery in `use-workspace-runs.ts`.
 *
 * `isLoading` / `error` belong here rather than to the caller: they describe an
 * operation in flight, and nothing outside this hook sets them.
 */

import { useCallback, useState } from "react";
import { appApi } from "@/lib/transport";
import { toast } from "@/components/ui";
import { useAppDispatch } from "@/lib/redux/hooks";
import { workspaceApi } from "@/lib/redux/api";
import { useActiveSpace } from "@/hooks/use-active-space";
import type { Run } from "../types";
import type { ContextItem } from "../lib/composer-context";
import {
  buildRunContextPayload,
  type Attachments,
} from "../lib/run-context-payload";

/** What a native code review is pointed at. */
export interface ReviewTarget {
  type: "uncommittedChanges" | "baseBranch" | "commit" | "custom";
  branch?: string;
  sha?: string;
  title?: string;
  instructions?: string;
}

export interface RunOperationsDeps {
  /** Pull a newly created run into the list, select it, and return its id. */
  registerNewRun: (runId: string) => Promise<string | null>;
  /** Refresh one run's transcript. */
  loadRunDetails: (runId: string) => Promise<void>;
  /** Replace one run in the list with a newer copy of it. */
  onRunUpdated: (run: Run) => void;
}

export function useRunOperations({
  registerNewRun,
  loadRunDetails,
  onRunUpdated,
}: RunOperationsDeps) {
  const dispatch = useAppDispatch();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stamped on every run this hook opens. The column existed and the payload
  // accepted it, but nothing filled it — so every run read back as belonging to
  // no space, and anything asking "which space is this run from?" got null.
  // Forks inherit it from their source run; continues reuse the row.
  const { activeSpaceId, activeSpace } = useActiveSpace();

  /** Wraps async run operations with loading state, account fetch, and error handling */
  const runOperation = useCallback(async <T>(
    fn: (accountId: string) => Promise<T>,
    fallback: T,
    errorLabel: string,
  ): Promise<T> => {
    setIsLoading(true);
    setError(null);
    try {
      const accountRes = await appApi.account.get();
      if (!accountRes.success || !accountRes.data) {
        throw new Error("No account found");
      }
      return await fn(accountRes.data.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : errorLabel;
      setError(message);
      toast.error(message);
      return fallback;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const executeRun = useCallback(
    async (
      goal: string,
      selectedWorkspace: string | undefined,
      selectedProvider: string,
      model?: string,
      uploads?: Attachments,
      context?: readonly ContextItem[],
      collectionId?: string | null,
    ) => {
      if (
        !goal.trim() ||
        !selectedProvider ||
        (activeSpace?.mode === "developer" && !selectedWorkspace)
      ) {
        toast.error("Please fill in all required fields");
        return null;
      }

      const { initialContext, ...contextPayload } = buildRunContextPayload(
        context,
        uploads,
      );

      return runOperation(async (accountId) => {
        const result = await appApi.runs.execute({
          accountId,
          workspaceId: selectedWorkspace || undefined,
          collectionId:
            activeSpace?.mode === "developer"
              ? undefined
              : collectionId || undefined,
          spaceId: activeSpaceId || undefined,
          providerId: selectedProvider,
          goal: goal.trim(),
          model: model || undefined,
          initialContext,
          ...contextPayload,
        });

        if (!result.success) {
          throw new Error(result.error || "Failed to start run");
        }

        return registerNewRun(result.data.runId);
      }, null, "Failed to execute run");
    },
    [runOperation, registerNewRun, activeSpaceId, activeSpace?.mode],
  );

  const continueRun = useCallback(async (
    runId: string,
    message: string,
    model?: string,
    uploads?: Attachments,
    context?: readonly ContextItem[],
  ) => {
    if (!message.trim()) {
      setError("Please enter a message");
      return false;
    }

    // Same projection as a fresh run; only the field the run payload calls it
    // by differs (`additionalContext` continues a transcript, `initialContext`
    // opens one).
    const { initialContext, ...contextPayload } = buildRunContextPayload(
      context,
      uploads,
    );

    return runOperation(async (accountId) => {
      const result = await appApi.runs.continue({
        runId,
        accountId,
        message: message.trim(),
        model: model || undefined,
        additionalContext: initialContext,
        ...contextPayload,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to continue run");
      }

      const runResult = await appApi.runs.getById(runId);
      if (runResult.success && runResult.data) {
        onRunUpdated(runResult.data);
      }

      void loadRunDetails(runId);

      dispatch(workspaceApi.util.invalidateTags(["Workspaces"]));
      return true;
    }, false, "Failed to continue run");
  }, [runOperation, dispatch, loadRunDetails, onRunUpdated]);

  const forkRun = useCallback(
    async (sourceRunId: string, message: string): Promise<string | null> => {
      if (!message.trim()) {
        setError("Please enter a message");
        return null;
      }

      return runOperation(async (accountId) => {
        const result = await appApi.runs.fork({
          sourceRunId,
          accountId,
          message: message.trim(),
        });

        if (!result.success) {
          throw new Error(result.error || "Failed to fork run");
        }

        return registerNewRun(result.data.runId);
      }, null, "Failed to fork run");
    },
    [runOperation, registerNewRun],
  );

  const executeReview = useCallback(
    async (
      selectedWorkspace: string,
      selectedProvider: string,
      target: ReviewTarget,
      model?: string,
    ): Promise<string | null> => {
      if (!selectedWorkspace || !selectedProvider) {
        toast.error("Please select a workspace and provider");
        return null;
      }

      return runOperation(async (accountId) => {
        const result = await appApi.runs.executeReview({
          accountId,
          workspaceId: selectedWorkspace,
          spaceId: activeSpaceId || undefined,
          providerId: selectedProvider,
          target,
          model: model || undefined,
        });

        if (!result.success) {
          throw new Error(result.error || "Failed to start review");
        }

        return registerNewRun(result.data.runId);
      }, null, "Failed to execute review");
    },
    [runOperation, registerNewRun, activeSpaceId],
  );

  const checkCanResume = useCallback(
    async (runId: string): Promise<boolean> => {
      try {
        const result = await appApi.runs.canResume(runId);
        return result.success && result.data === true;
      } catch {
        return false;
      }
    },
    [],
  );

  return {
    isLoading,
    error,
    executeRun,
    continueRun,
    forkRun,
    executeReview,
    checkCanResume,
  };
}
