import { useLayoutEffect, useRef, type ReactNode } from "react";

export interface TranscriptListRow {
  id: string;
  groupIndex?: number;
  render(): ReactNode;
}

/** Loaded rows stay mounted and take their natural height while scrolling. */
export function TranscriptList({ rows, onResize }: {
  rows: TranscriptListRow[];
  onResize(): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [onResize]);

  return <div ref={list} className="space-y-4" data-transcript-list="">
    {rows.map((row) => <div key={row.id} data-history-id={row.id} data-group-index={row.groupIndex}
      className="flow-root space-y-4">{row.render()}</div>)}
  </div>;
}
