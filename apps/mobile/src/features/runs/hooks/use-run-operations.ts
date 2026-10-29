import { useCallback, useState } from "react";

import { backendSession, useSession } from "@/backend/backend-session";
import {
  serializeComposerAttachments,
  type ComposerAttachment,
} from "@/lib/composer-attachments";
import { attachedSkills, composeGoal } from "@/lib/context-picker";
import type { PromptSkill } from "@/lib/prompt-chips";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import type { ConversationSettings } from "@mains/contracts/run-settings";
import { beginSettingsIntent, rememberAcceptedSettings, waitForComposerSettings } from "@/backend/composer-settings";
import { useAiDataConsent } from "@/features/ai-data-consent";

/** The desktop's opening line for a fork, kept word for word. */
const FORK_MESSAGE = "Continue from where this session left off.";

/** Agents whose running turn takes another message — the Mac's own `steerRun` check. */
const STEERABLE_PROVIDERS: ReadonlySet<string> = new Set([PROVIDER_IDS.codex, PROVIDER_IDS.claude]);

/** The Mac's refusals when the turn ended before the message reached it. */
const TURN_ENDED = /no active (?:codex |claude )?turn to steer|active turn changed/i;

interface RunOperationTarget {
  id: string;
  providerId: string;
  status: string;
}

export interface RunContinuationInput {
  /** The exact text visible in the composer before its mentions are serialized. */
  sourceText: string;
  contextSkills: PromptSkill[];
  attachments: ComposerAttachment[];
}

export interface PreparedRunContinuation {
  /** The wire-ready message, including `$skill` tokens. */
  message: string;
  /** Only skills whose inline mentions still exist in `sourceText`. */
  skills: PromptSkill[];
}

interface RunSteerLifecycle {
  /** Called once the running turn has taken the message. */
  onAccepted: () => void;
}

interface RunContinuationLifecycle {
  /** Called after consent + serialization, immediately before the backend command. */
  onOptimisticStart: (prepared: PreparedRunContinuation) => void;
  /** Called only when a command fails after the optimistic state became visible. */
  onOptimisticRollback: () => void;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/**
 * The write side of a run screen: continuing, steering, forking and stopping a run.
 * Operation-owned progress and errors stay behind this Interface; the caller
 * only supplies the two lifecycle moments needed by its native prompt flight.
 */
export function useRunOperations({
  run,
  turnIsActive,
  conversationSettings,
}: {
  run: RunOperationTarget | null;
  turnIsActive: boolean;
  conversationSettings: ConversationSettings;
}) {
  const session = useSession();
  const { requestConsent } = useAiDataConsent();
  const [sending, setSending] = useState(false);
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backendId = session.backend?.backendId ?? "";
  const connected = session.connection.kind === "connected";
  const runId = run?.id ?? "";
  const providerId = run?.providerId ?? "";
  const runIsLive = run?.status === "running" || run?.status === "queued";
  /** A turn is running that can take another message now, rather than after it ends. */
  const canSteer = run?.status === "running" && STEERABLE_PROVIDERS.has(providerId);

  const continueRun = useCallback(
    async (input: RunContinuationInput, lifecycle: RunContinuationLifecycle): Promise<void> => {
      const message = composeGoal(input.sourceText, input.contextSkills);
      if (
        (!message && input.attachments.length === 0) ||
        !run ||
        runIsLive ||
        !connected ||
        sending
      ) {
        return;
      }

      const skills = attachedSkills(input.sourceText, input.contextSkills);
      let optimisticStarted = false;
      const settingsRevision = beginSettingsIntent(backendId, providerId);
      setSending(true);
      setError(null);
      try {
        const allowed = await requestConsent(backendId, providerId);
        if (!allowed) return;

        await waitForComposerSettings(backendId, providerId, runId);

        const attachments = await serializeComposerAttachments(input.attachments);
        lifecycle.onOptimisticStart({ message, skills });
        optimisticStarted = true;

        const result = await backendSession.continueRun(
          runId,
          message,
          skills,
          conversationSettings,
          attachments,
        );
        if (result.success) {
          rememberAcceptedSettings(backendId, providerId, conversationSettings, settingsRevision);
          return;
        }

        optimisticStarted = false;
        lifecycle.onOptimisticRollback();
        setError(result.error);
      } catch (caught) {
        if (optimisticStarted) {
          optimisticStarted = false;
          lifecycle.onOptimisticRollback();
        }
        setError(errorMessage(caught, "Could not send"));
      } finally {
        setSending(false);
      }
    },
    [backendId, connected, conversationSettings, providerId, requestConsent, run, runId, runIsLive, sending],
  );

  // No flying bubble: that handoff waits for the next turn's prompt, and a
  // steer joins the current one. The text stays in the composer until the
  // Mac takes it, then the refetch brings the durable prompt in.
  const steerRun = useCallback(
    async (input: RunContinuationInput, lifecycle: RunSteerLifecycle): Promise<void> => {
      const message = composeGoal(input.sourceText, input.contextSkills);
      if ((!message && input.attachments.length === 0) || !run || !canSteer || !connected || sending) {
        return;
      }
      setSending(true);
      setError(null);
      try {
        const allowed = await requestConsent(backendId, providerId);
        if (!allowed) return;
        const attachments = await serializeComposerAttachments(input.attachments);
        const result = await backendSession.steerRun(
          runId,
          message,
          attachedSkills(input.sourceText, input.contextSkills),
          attachments,
        );
        if (result.success) {
          lifecycle.onAccepted();
          return;
        }
        // The Mac's wording speaks of its own message queue, which the phone
        // does not have; the draft simply stays here to send as a follow-up.
        setError(TURN_ENDED.test(result.error)
          ? "The agent finished before your message reached it. Send it again to continue."
          : result.error);
      } catch (caught) {
        setError(errorMessage(caught, "Could not send"));
      } finally {
        setSending(false);
      }
    },
    [backendId, canSteer, connected, providerId, requestConsent, run, runId, sending],
  );

  const forkRun = useCallback(async (): Promise<string | null> => {
    if (!run || forking || turnIsActive || !connected) return null;
    setForking(true);
    setError(null);
    try {
      const allowed = await requestConsent(backendId, providerId);
      if (!allowed) return null;
      const result = await backendSession.forkRun(runId, FORK_MESSAGE);
      if (!result.success) {
        setError(result.error);
        return null;
      }
      return result.data.runId;
    } catch (caught) {
      setError(errorMessage(caught, "Could not fork this run"));
      return null;
    } finally {
      setForking(false);
    }
  }, [backendId, connected, forking, providerId, requestConsent, run, runId, turnIsActive]);

  const stopRun = useCallback(async (): Promise<void> => {
    if (!run || !connected) return;
    setError(null);
    try {
      const result = await backendSession.abortRun(runId);
      if (!result.success) setError(result.error);
    } catch (caught) {
      setError(errorMessage(caught, "Could not stop this run"));
    }
  }, [connected, run, runId]);

  return {
    continueRun,
    steerRun,
    canSteer,
    forkRun,
    stopRun,
    sending,
    forking,
    error,
  };
}
