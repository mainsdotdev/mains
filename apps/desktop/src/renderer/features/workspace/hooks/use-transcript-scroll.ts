import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { RunEvent } from "../types";
import type { TranscriptHistory } from "./use-run-history";
import { rememberTranscriptPosition, type TranscriptViewState } from "../lib/transcript-view-state";

interface Anchor { id: string; top: number; revision: symbol }

export function useTranscriptScroll(
  runId: string,
  events: RunEvent[], visible: boolean, history?: TranscriptHistory, view?: TranscriptViewState | null,
) {
  const container = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const landed = useRef<string | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const paging = useRef(false);
  const latestRevision = useRef(0);
  const wasVisible = useRef(false);
  const resizeFrame = useRef<number | null>(null);
  const eventRevision = useMemo(() => Symbol(String(events.length)), [events]);

  const page = useCallback(async (direction: "older" | "newer" | "latest" | "refresh") => {
    const element = container.current;
    if (!element || !history || history.loading || paging.current) return;
    paging.current = true;
    const toLatest = direction === "latest" || (direction === "refresh" && !history.latestRevision);
    following.current = toLatest;
    history.setFollowing(toLatest);
    const top = element.getBoundingClientRect().top;
    const row = Array.from(element.querySelectorAll<HTMLElement>("[data-history-id]"))
      .find((candidate) => candidate.getBoundingClientRect().bottom > top);
    anchor.current = !toLatest && row
      ? { id: row.dataset.historyId!, top: row.getBoundingClientRect().top - top, revision: eventRevision }
      : null;
    try {
      await (direction === "older" ? history.loadOlder() : direction === "newer" ? history.loadNewer() : direction === "refresh" ? history.retry() : history.loadLatest());
    } finally {
      paging.current = false;
    }
  }, [container, eventRevision, history]);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element || !visible) { wasVisible.current = false; return; }
    const landing = landed.current !== runId || !wasVisible.current;
    wasVisible.current = true;
    if (landing || latestRevision.current !== (history?.latestRevision ?? 0)) {
      latestRevision.current = history?.latestRevision ?? 0;
      landed.current = runId;
      const restore = landing && view?.scrollOffset != null && view.latestRevision === (history?.latestRevision ?? 0);
      following.current = restore ? view.followTail : true;
      anchor.current = null;
      element.scrollTop = restore && !view.followTail ? view.scrollOffset! : element.scrollHeight;
      if (view) rememberTranscriptPosition(view, { latestRevision: history?.latestRevision ?? 0 });
      return;
    }
    if (history?.error) anchor.current = null;
    const saved = anchor.current;
    if (saved && saved.revision !== eventRevision) {
      const row = Array.from(element.querySelectorAll<HTMLElement>("[data-history-id]"))
        .find((candidate) => candidate.dataset.historyId === saved.id);
      if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.top;
      anchor.current = null;
    } else if (!saved && following.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [container, runId, eventRevision, visible, history?.error, history?.latestRevision, view]);

  const onResize = useCallback(() => {
    if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = requestAnimationFrame(() => {
      resizeFrame.current = null;
      if (following.current && container.current) container.current.scrollTop = container.current.scrollHeight;
    });
  }, []);
  useLayoutEffect(() => () => { if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current); }, []);

  const onScroll = useCallback(() => {
    const element = container.current;
    if (!element || paging.current || landed.current !== runId) return;
    const atEnd = element.scrollHeight - element.clientHeight - element.scrollTop < 80;
    following.current = atEnd && !history?.hasNewer;
    if (view) rememberTranscriptPosition(view, { scrollOffset: element.scrollTop, followTail: following.current });
    history?.setFollowing(following.current);
    if (element.scrollTop < 200 && !atEnd && history?.hasOlder) void page("older");
    else if (atEnd && history?.hasNewer) void page("newer");
  }, [container, runId, history, page, view]);
  return { container, onScroll, page, onResize };
}
