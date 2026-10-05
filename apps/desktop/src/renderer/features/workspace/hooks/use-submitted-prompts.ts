import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UploadedFile } from "@/components/ui";
import type { Run, RunEvent } from "../types";
import type { ContextItem } from "../lib/composer-context";
import { buildRunContextPayload } from "../lib/run-context-payload";

interface SubmittedPrompt {
  id: string;
  ownerKey: string;
  viewKey: string;
  runId: string | null;
  sending: boolean;
  event: RunEvent;
}

/** Local feedback only; the provider's persisted prompt remains authoritative. */
export function useSubmittedPrompts({ ownerKey, viewKey, activeRunId, events, runs, historical }: {
  ownerKey: string;
  viewKey: string;
  activeRunId: string | null;
  events: RunEvent[];
  runs: Run[];
  historical: boolean;
}) {
  const [submitted, setSubmitted] = useState<SubmittedPrompt[]>([]);
  const previewUrls = useRef(new Map<string, string[]>());
  useEffect(() => {
    const retained = new Set(submitted.map((item) => item.id));
    for (const [id, urls] of previewUrls.current) {
      if (retained.has(id)) continue;
      urls.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.current.delete(id);
    }
  }, [submitted]);
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const previews of urls.values()) previews.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const begin = useCallback((text: string, context: readonly ContextItem[], files: readonly UploadedFile[], runId: string | null) => {
    const id = crypto.randomUUID();
    const payload = buildRunContextPayload(context);
    // The composer revokes its own URLs on acceptance. This message owns its
    // previews until reconciliation, rejection or unmount instead.
    const previews: string[] = [];
    const attachments = files.map((file) => {
      const dataUrl = file.type === "image" ? URL.createObjectURL(file.file) : file.preview;
      if (file.type === "image") previews.push(dataUrl!);
      return { name: file.file.name, type: file.type, mimeType: file.file.type, dataUrl };
    });
    previewUrls.current.set(id, previews);
    const event: RunEvent = {
      id: `pending-prompt:${id}`, type: "artifact", content: text, timestamp: new Date(),
      metadata: {
        kind: "user-prompt", source: "user", clientPromptId: id,
        issues: payload.contextIssues, signals: payload.contextSignals,
        files: payload.contextFiles, skills: payload.contextSkills,
        attachments: [
          ...attachments,
          ...(payload.attachments ?? []).map(({ name, type, mimeType, sourcePath }) => ({ name, type, mimeType, sourcePath })),
        ],
      },
    };
    setSubmitted((current) => [...current, { id, ownerKey, viewKey, runId, sending: true, event }]);
    return id;
  }, [ownerKey, viewKey]);

  const accept = useCallback((id: string, runId: string) => {
    setSubmitted((current) => current.map((item) => item.id === id ? { ...item, runId, sending: false } : item));
  }, []);
  const reject = useCallback((id: string) => {
    setSubmitted((current) => current.filter((item) => item.id !== id));
  }, []);

  // Reconcile by identity, never by text: identical prompts are separate inputs.
  // Keep the pre-run projection until the created conversation is on screen.
  const outstanding = useMemo(() => {
    const persisted = new Set(events.filter((event) => event.metadata?.kind === "user-prompt")
      .map((event) => event.metadata?.clientPromptId));
    return submitted.filter((item) => item.viewKey !== viewKey || item.runId !== activeRunId || !persisted.has(item.id));
  }, [events, activeRunId, viewKey, submitted]);
  if (outstanding.length !== submitted.length) setSubmitted(outstanding);

  const visible = useMemo(() => submitted.filter((item) => item.viewKey === viewKey && (item.sending || !historical) &&
    (item.runId === activeRunId && activeRunId !== null || item.ownerKey === ownerKey && (!item.runId || !activeRunId))),
  [submitted, viewKey, activeRunId, ownerKey, historical]);
  const currentEvents = useMemo(() => {
    if (!visible.length) return events;
    const merged = activeRunId ? [...events] : [];
    for (const item of visible) {
      if (merged.some((event) => event.metadata?.kind === "user-prompt" && event.metadata?.clientPromptId === item.id)) continue;
      const run = runs.find((run) => run.id === item.runId);
      const event = !item.sending && (run?.status === "failed" || run?.status === "canceled")
        ? { ...item.event, metadata: { ...item.event.metadata, sendError: run.lastError || "Message was not sent." } } : item.event;
      // Insert before newer agent events without reordering unrelated streams.
      const index = merged.findIndex((existing) => existing.timestamp > event.timestamp);
      if (index < 0) merged.push(event);
      else merged.splice(index, 0, event);
    }
    return merged;
  }, [events, activeRunId, visible, runs]);

  return { begin, accept, reject, currentEvents, hasSubmittedPrompt: visible.length > 0,
    isSubmitting: visible.some((item) => item.sending) || (!activeRunId && visible.length > 0) };
}
