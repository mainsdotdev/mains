import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createTranscriptPaging, TranscriptScroll, PIN_DISTANCE } from "@mains/contracts/transcript-viewport";
import type { RunEvent } from "../types";
import type { TranscriptHistory } from "./use-run-history";
import { rememberTranscriptPosition, type TranscriptViewState } from "../lib/transcript-view-state";

interface Anchor { id: string; top: number; revision: symbol }

export function useTranscriptScroll(
  runId: string,
  events: RunEvent[], visible: boolean, history?: TranscriptHistory, view?: TranscriptViewState | null,
) {
  const container = useRef<HTMLDivElement>(null);
  const [intent] = useState(() => new TranscriptScroll());
  const landed = useRef<string | null>(null);
  const [paging] = useState(() => createTranscriptPaging<Anchor>(intent));
  const offset = useRef<number | null>(null);
  const scope = useRef<string | null>(runId);
  const latestRevision = useRef(0);
  const wasVisible = useRef(false);
  const resizeFrame = useRef<number | null>(null);
  const eventRevision = useMemo(() => Symbol(String(events.length)), [events]);
  useLayoutEffect(() => {
    scope.current = visible ? runId : null;
    return () => {
      scope.current = null;
      paging.reset();
      if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = null;
    };
  }, [paging, runId, visible]);

  const page = useCallback(async (direction: "older" | "newer" | "latest" | "refresh") => {
    const element = container.current;
    if (!element || !history || history.loading || scope.current !== runId) return;
    const toLatest = direction === "latest" || (direction === "refresh" && !history.latestRevision);
    const top = element.getBoundingClientRect().top;
    const row = Array.from(element.querySelectorAll<HTMLElement>("[data-history-id]"))
      .find((candidate) => candidate.getBoundingClientRect().bottom > top);
    const lease = paging.begin(!toLatest && row
      ? { id: row.dataset.historyId!, top: row.getBoundingClientRect().top - top, revision: eventRevision }
      : null, toLatest);
    if (!lease) return;
    history.setFollowing(toLatest);
    try {
      await (direction === "older" ? history.loadOlder() : direction === "newer" ? history.loadNewer() : direction === "refresh" ? history.retry() : history.loadLatest());
    } catch {
      if (lease.current()) history.setFollowing(false);
      lease.finish(true);
    } finally {
      lease.finish();
    }
  }, [container, eventRevision, history, paging, runId]);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element || !visible) { wasVisible.current = false; return; }
    const landing = landed.current !== runId || !wasVisible.current;
    wasVisible.current = true;
    if (landing || latestRevision.current !== (history?.latestRevision ?? 0)) {
      latestRevision.current = history?.latestRevision ?? 0;
      landed.current = runId;
      const restore = landing && view?.scrollOffset != null && view.latestRevision === (history?.latestRevision ?? 0);
      if (restore ? view.followTail : !history?.historical && history?.following !== false) intent.follow();
      else intent.pause();
      paging.clearAnchor();
      if (restore && !view.followTail) element.scrollTop = view.scrollOffset!;
      else if (intent.pinned) element.scrollTop = element.scrollHeight;
      offset.current = element.scrollTop;
      if (view) rememberTranscriptPosition(view, { latestRevision: history?.latestRevision ?? 0 });
      return;
    }
    if (history?.error) paging.clearAnchor();
    const saved = paging.anchor;
    if (saved && saved.revision !== eventRevision) {
      const row = Array.from(element.querySelectorAll<HTMLElement>("[data-history-id]"))
        .find((candidate) => candidate.dataset.historyId === saved.id);
      if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.top;
      paging.clearAnchor();
      offset.current = element.scrollTop;
    } else if (!saved && intent.pinned) {
      element.scrollTop = element.scrollHeight;
      offset.current = element.scrollTop;
    }
  }, [container, runId, eventRevision, visible, history?.error, history?.latestRevision, history?.historical, history?.following, view, intent, paging]);

  const onResize = useCallback(() => {
    if (scope.current !== runId) return;
    if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = requestAnimationFrame(() => {
      resizeFrame.current = null;
      if (scope.current === runId && intent.pinned && container.current) {
        container.current.scrollTop = container.current.scrollHeight;
        offset.current = container.current.scrollTop;
      }
    });
  }, [intent, runId]);

  const onScroll = useCallback(() => {
    const element = container.current;
    if (!element || paging.loading || landed.current !== runId || scope.current !== runId) return;
    const movement = offset.current === null ? 0 : element.scrollTop - offset.current;
    offset.current = element.scrollTop;
    if (Math.abs(movement) < 1) return;
    const atEnd = element.scrollHeight - element.clientHeight - element.scrollTop < PIN_DISTANCE;
    if (atEnd && !history?.hasNewer) intent.follow(); else intent.pause();
    if (view) rememberTranscriptPosition(view, { scrollOffset: element.scrollTop, followTail: intent.pinned });
    history?.setFollowing(intent.pinned);
    if (movement < 0 && element.scrollTop < 200 && !atEnd && history?.hasOlder) void page("older");
    else if (movement > 0 && atEnd && history?.hasNewer) void page("newer");
  }, [container, runId, history, page, view, intent, paging]);
  return { container, onScroll, page, onResize };
}
