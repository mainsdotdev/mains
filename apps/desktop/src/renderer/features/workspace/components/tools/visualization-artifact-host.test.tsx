// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VisualizationArtifact } from "./visualization-artifact";
import type { VisualizationControls } from "@mains/contracts/visualization";

vi.mock("@/hooks/use-dark-mode", () => ({ useDarkMode: () => ({ darkMode: false }) }));
vi.mock("@/hooks/use-local-visualization-url", () => ({ useLocalVisualizationUrl: (src: string) => `https://preview.test/${encodeURIComponent(src)}` }));

class Port {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn(); start = vi.fn(); close = vi.fn();
}
const channels: Array<{ port1: Port; port2: Port }> = [];
const controls: VisualizationControls = { language: "en", previewing: false, groups: [],
  carousels: [{ id: "carousel", label: "Designs", previousLabel: "Previous", nextLabel: "Next", selectedId: "first",
    variants: [{ id: "first", label: "First" }, { id: "second", label: "Second" }] }] };

beforeEach(() => {
  channels.length = 0;
  vi.stubGlobal("MessageChannel", class {
    port1 = new Port(); port2 = new Port();
    constructor() { channels.push(this); }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("fences snapshots and commands to their iframe connection across reload, path changes and unmount", () => {
  const view = render(<VisualizationArtifact absPath="/first.html" />);
  const iframe = screen.getByTitle("Interactive visualization: first.html") as HTMLIFrameElement;
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});
  fireEvent.load(iframe);
  const first = channels[0].port1;
  const late = first.onmessage!;
  act(() => late({ data: { type: "mockup-controls", controls } } as MessageEvent));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(first.postMessage).toHaveBeenCalledWith({ type: "mockup-command", command: { type: "select-variant", carouselId: "carousel", variantId: "second" } });
  first.postMessage.mockClear();
  fireEvent.load(iframe);
  expect(first.close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  act(() => late({ data: { type: "mockup-controls", controls } } as MessageEvent));
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  const second = channels[1].port1;
  act(() => second.onmessage!({ data: { type: "mockup-controls", controls } } as MessageEvent));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(second.postMessage).toHaveBeenCalledOnce();
  expect(first.postMessage).not.toHaveBeenCalled();
  view.rerender(<VisualizationArtifact absPath="/different.html" />);
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(second.close).toHaveBeenCalledOnce();
  view.unmount();
});

it("ignores invalid control messages without mounting their UI", () => {
  render(<VisualizationArtifact absPath="/first.html" />);
  const iframe = screen.getByTitle("Interactive visualization: first.html") as HTMLIFrameElement;
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});
  fireEvent.load(iframe);
  act(() => channels[0].port1.onmessage!({ data: { type: "mockup-controls", controls: { ...controls, groups: "invalid" } } } as MessageEvent));
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
});
