// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscriptWindow, type TranscriptWindowRow } from "./transcript-window";
import { createTranscriptViewCache, TranscriptItemScope, TranscriptViewProvider, useToolExpansion } from "../lib/transcript-view-state";

afterEach(() => vi.restoreAllMocks());
function Body({ id }: { id: string }) {
  const [expanded, setExpanded] = useToolExpansion();
  return <button onClick={() => setExpanded((value) => !value)}>{id}{expanded ? " open" : " closed"}</button>;
}

function setup() {
  const scroll = createRef<HTMLDivElement>();
  const view = createTranscriptViewCache().get("run");
  const rows: TranscriptWindowRow[] = Array.from({ length: 100 }, (_, index) => ({
    id: `r-${index}`, groupIndex: index, estimate: 120,
    render: () => <TranscriptItemScope id={`r-${index}`}><Body id={`body-${index}`} /></TranscriptItemScope>,
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const id = this.dataset.historyId;
    const height = id || this.parentElement?.dataset.historyId ? 120 : 500;
    const top = id ? Number(id.slice(2)) * 120 - (scroll.current?.scrollTop ?? 0) : 0;
    return { top, bottom: top + height, height, width: 800, left: 0, right: 800 } as DOMRect;
  });
  const result = render(<TranscriptViewProvider view={view}><div ref={scroll}>
    <TranscriptWindow rows={rows} view={view} scrollRef={scroll} onResize={() => {}} />
  </div></TranscriptViewProvider>);
  Object.defineProperty(scroll.current, "clientHeight", { value: 500 });
  fireEvent.scroll(scroll.current!);
  return { ...result, view, scroll };
}

describe("transcript viewport", () => {
  it("mounts only visible bodies and a buffer while keeping lightweight scroll targets", () => {
    const { container, scroll } = setup();
    expect(container.querySelectorAll("[data-history-id]")).toHaveLength(100);
    expect(container.querySelectorAll("button").length).toBeLessThan(20);
    expect(screen.getByText("body-0 closed")).toBeTruthy();
    expect(screen.queryByText("body-70 closed")).toBeNull();
    act(() => { scroll.current!.scrollTop = 8400; fireEvent.scroll(scroll.current!); });
    expect(screen.getByText("body-70 closed")).toBeTruthy();
    expect(screen.queryByText("body-0 closed")).toBeNull();
    expect(container.querySelectorAll("button").length).toBeLessThan(20);
  });

  it("restores accordion state after its body leaves and re-enters the viewport", () => {
    const { scroll, view } = setup();
    fireEvent.click(screen.getByText("body-0 closed"));
    act(() => { scroll.current!.scrollTop = 8400; fireEvent.scroll(scroll.current!); });
    expect(screen.queryByText("body-0 open")).toBeNull();
    act(() => { scroll.current!.scrollTop = 0; fireEvent.scroll(scroll.current!); });
    expect(screen.getByText("body-0 open")).toBeTruthy();
    expect(view.values.get("r-0/expanded")).toBe(true);
  });
});
