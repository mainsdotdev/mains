// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDocx } from "./render-docx";

const { renderAsync } = vi.hoisted(() => ({ renderAsync: vi.fn() }));
vi.mock("docx-preview", () => ({ renderAsync }));

let viewport: HTMLDivElement;
let container: HTMLDivElement;
let width: number;
let resize: () => void;
const disconnect = vi.fn();

beforeEach(() => {
  width = 320;
  viewport = document.createElement("div");
  Object.defineProperty(viewport, "clientWidth", { get: () => width });
  container = document.createElement("div");
  viewport.append(container);
  document.body.append(viewport);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  renderAsync.mockImplementation(async (_buf: ArrayBuffer, target: HTMLElement) => {
    const wrapper = document.createElement("div");
    wrapper.className = "docx-wrapper";
    for (const pageWidth of [816, 1056]) {
      const page = document.createElement("section");
      page.className = "docx";
      page.style.width = `${pageWidth}px`;
      Object.defineProperty(page, "offsetWidth", { value: pageWidth });
      wrapper.append(page);
    }
    target.replaceChildren(wrapper);
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DOCX panel sizing", () => {
  it("fits the widest page without reflowing the document's columns", async () => {
    await renderDocx(new ArrayBuffer(0), container, { viewport, zoom: 1 });
    expect(container.style.width).toBe("1056px");
    expect(Number(container.style.zoom)).toBeCloseTo(320 / 1056);
    expect(container.style.transform).toBe("");
    expect(Array.from(container.querySelectorAll<HTMLElement>("section.docx"), (page) => page.style.width))
      .toEqual(["816px", "1056px"]);
  });

  it("refits on panel resize and applies manual zoom relative to the fitted page", async () => {
    const controller = await renderDocx(new ArrayBuffer(0), container, { viewport, zoom: 1 });
    width = 640;
    resize();
    expect(Number(container.style.zoom)).toBeCloseTo(640 / 1056);
    controller.setZoom(1.5);
    expect(Number(container.style.zoom)).toBeCloseTo(640 / 1056 * 1.5);
    expect(renderAsync).toHaveBeenCalledTimes(1);
  });

  it("recovers when a hidden document tab becomes visible and releases its observer", async () => {
    width = 0;
    const controller = await renderDocx(new ArrayBuffer(0), container, { viewport, zoom: 1.5 });
    width = 480;
    resize();
    expect(Number(container.style.zoom)).toBeCloseTo(480 / 1056 * 1.5);
    controller.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    width = 280;
    resize();
    expect(Number(container.style.zoom)).toBeCloseTo(480 / 1056 * 1.5);
  });
});
