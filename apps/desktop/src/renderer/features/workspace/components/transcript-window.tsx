import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { rememberRowHeight, rememberTranscriptPosition, type TranscriptViewState } from "../lib/transcript-view-state";

export interface TranscriptWindowRow {
  id: string;
  groupIndex?: number;
  estimate: number;
  render(): ReactNode;
}

function sameIds(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Paging caps the number of placeholders; only nearby bodies hold a React tree. */
export function TranscriptWindow({ rows, scrollRef, view, onResize }: {
  rows: TranscriptWindowRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  view: TranscriptViewState;
  onResize(): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => new Set(rows.slice(-6).map((row) => row.id)));
  const update = useCallback(() => {
    const container = scrollRef.current;
    const element = list.current;
    if (!container || !element) return;
    const rect = container.getBoundingClientRect();
    const buffer = Math.max(800, container.clientHeight);
    const next = new Set<string>();
    for (const child of Array.from(element.children) as HTMLElement[]) {
      const row = child.getBoundingClientRect();
      if (row.bottom >= rect.top - buffer && row.top <= rect.bottom + buffer) next.add(child.dataset.historyId!);
    }
    setVisible((previous) => sameIds(previous, next) ? previous : next);
  }, [scrollRef]);
  // The scroll container belongs to our parent; its ref is attached after child
  // layout effects. Subscribe after that commit so the initial mount works too.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => { rememberTranscriptPosition(view, { scrollOffset: container.scrollTop }); update(); };
    container.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    update();
    return () => { container.removeEventListener("scroll", onScroll); observer?.disconnect(); };
  }, [scrollRef, view, update]);
  useLayoutEffect(update, [update, rows]);

  return <div ref={list} className="space-y-4" data-transcript-window="">
    {rows.map((row) => <WindowRow key={row.id} row={row} view={view} visible={visible.has(row.id)}
      scrollRef={scrollRef} onResize={onResize} update={update} />)}
  </div>;
}

function WindowRow({ row, view, visible, scrollRef, onResize, update }: {
  row: TranscriptWindowRow; view: TranscriptViewState; visible: boolean;
  scrollRef: RefObject<HTMLDivElement | null>; onResize(): void; update(): void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(() => view.heights.get(row.id) ?? row.estimate);
  useLayoutEffect(() => {
    const element = body.current;
    if (!visible || !element) return;
    const measure = () => {
      const next = Math.ceil(element.getBoundingClientRect().height);
      if (!Number.isFinite(next) || next < 0 || Math.abs(next - height) < 1) return;
      const container = scrollRef.current;
      const above = container && wrapper.current && wrapper.current.getBoundingClientRect().bottom < container.getBoundingClientRect().top;
      rememberRowHeight(view, row.id, next);
      setHeight(next);
      if (above) container.scrollTop += next - height;
      onResize();
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [visible, view, row.id, height, scrollRef, onResize]);
  useLayoutEffect(update, [height, update]);
  return <div ref={wrapper} data-history-id={row.id} data-group-index={row.groupIndex}
    data-transcript-mounted={visible ? "" : undefined} style={{ height }}>
    {visible && <div ref={body} className="flow-root space-y-4">{row.render()}</div>}
  </div>;
}
