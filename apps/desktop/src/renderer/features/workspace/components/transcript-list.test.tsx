// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscriptList, type TranscriptListRow } from "./transcript-list";
import { createTranscriptViewCache, TranscriptItemScope, TranscriptViewProvider, useToolExpansion } from "../lib/transcript-view-state";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Body({ id }: { id: string }) {
  const [expanded, setExpanded] = useToolExpansion();
  return <button onClick={() => setExpanded((value) => !value)}>{id}{expanded ? " open" : " closed"}</button>;
}

function setup() {
  const scroll = createRef<HTMLDivElement>();
  const view = createTranscriptViewCache().get("run");
  const rows: TranscriptListRow[] = Array.from({ length: 100 }, (_, index) => ({
    id: `r-${index}`, groupIndex: index,
    render: () => <TranscriptItemScope id={`r-${index}`}><Body id={`body-${index}`} /></TranscriptItemScope>,
  }));
  const result = render(<TranscriptViewProvider view={view}><div ref={scroll}>
    <TranscriptList rows={rows} onResize={() => {}} />
  </div></TranscriptViewProvider>);
  return { ...result, view, scroll };
}

describe("transcript list", () => {
  it("keeps every loaded message and tool body mounted while scrolling", () => {
    const { container, scroll } = setup();
    expect(container.querySelectorAll("button")).toHaveLength(100);
    fireEvent.click(screen.getByText("body-0 closed"));
    const first = screen.getByText("body-0 open");
    const last = screen.getByText("body-99 closed");
    act(() => { scroll.current!.scrollTop = 8400; fireEvent.scroll(scroll.current!); });
    expect(first.isConnected).toBe(true);
    expect(last.isConnected).toBe(true);
    expect(container.querySelectorAll("button")).toHaveLength(100);
    act(() => { scroll.current!.scrollTop = 0; fireEvent.scroll(scroll.current!); });
    expect(screen.getByText("body-0 open")).toBe(first);
    expect(container.querySelector('[data-history-id="r-99"]')?.getAttribute("data-group-index")).toBe("99");
  });

  it("reports content resizing without changing row heights or the scroll offset", () => {
    let resize!: ResizeObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const onResize = vi.fn();
    const scroll = createRef<HTMLDivElement>();
    const result = render(<div ref={scroll}><TranscriptList onResize={onResize} rows={[
      { id: "message", render: () => <p>Message</p> },
    ]} /></div>);
    scroll.current!.scrollTop = 250;
    act(() => resize([], {} as ResizeObserver));
    expect(onResize).toHaveBeenCalledOnce();
    expect(scroll.current!.scrollTop).toBe(250);
    expect((result.container.querySelector('[data-history-id="message"]') as HTMLElement).style.height).toBe("");
    result.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
