import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageProxyService, serveLocalVisualization } from "@mains/backend/modules/imageProxy";
import { parseVisualizationControls, type VisualizationCommand } from "@mains/contracts/visualization";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const cleanup: Array<() => void> = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function open(fragment: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-visualization-runtime-"));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "mockup.html");
  fs.writeFileSync(file, fragment);
  const url = new URL(imageProxyService.signLocalVisualizationUrl(file)!);
  const response = await serveLocalVisualization(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
  const errors: unknown[] = [];
  const dom = new JSDOM(await response.text(), {
    url: url.href, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(win: Window) {
      win.matchMedia = vi.fn().mockReturnValue({ matches: false });
      win.addEventListener("error", (event) => errors.push(event.error));
    },
  });
  const win = dom.window as Window & typeof globalThis & Record<string, any>;
  cleanup.push(() => { try { expect(errors).toEqual([]); } finally { win.close(); } });
  await new Promise<void>((resolve) => win.document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
  await tick();
  const port = { postMessage: vi.fn(), start: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null };
  win.dispatchEvent(new win.MessageEvent("message", {
    source: win, ports: [port as unknown as MessagePort],
    data: { type: "mains-visualization-init", theme: "light" },
  }));
  const snapshot = () => {
    const raw = port.postMessage.mock.calls.filter(([message]) => message.type === "mockup-controls").at(-1)?.[0].controls;
    const controls = parseVisualizationControls(raw);
    expect(controls).not.toBeNull();
    return controls!;
  };
  const command = async (command: VisualizationCommand) => {
    port.onmessage!({ data: { type: "mockup-command", command } } as MessageEvent);
    await tick();
    return snapshot();
  };
  return { win, doc: win.document, port, snapshot, command };
}

const fragment = `
<div lang="en-US" class="viz-carousel viz-dotted-background" aria-label="Launch designs" data-previous-label="Back" data-next-label="Forward">
  <section data-variant="Expand" aria-label="Expansion"><button data-play>Play</button></section>
  <section data-variant="Trace" aria-label="Outline" hidden><button data-play>Play</button></section>
  <section data-variant="Connect" aria-label="Connection" hidden><button data-play>Play</button></section>
</div>
<script>
window.settings = []; window.tweaks = [];
for (const target of document.querySelectorAll('[data-variant]')) {
  const state = { duration: 520, color: '#1234', enabled: true, appearance: 'system' };
  const render = () => { target.dataset.duration = String(state.duration); };
  render();
  const tweak = new Tweak({ container: target, onChange: render });
  tweak.addSlider(state, 'duration', { label: 'Duration', min: 350, max: 900, step: 10, unit: 'ms', reference: '--duration' })
    .addColorPicker(state, 'color', { label: 'Tint' })
    .addToggle(state, 'enabled', { label: 'Enabled' })
    .addSelect(state, 'appearance', { label: 'Appearance', options: ['system', { label: 'Dark', value: 'dark' }] });
  window.settings.push(state); window.tweaks.push(tweak);
  target.querySelector('[data-play]').onclick = () => { target.dataset.played = 'true'; };
}
</script>`;

afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });

describe("served visualization control bridge", () => {
  it("replays a validated catalog on host connection without creating duplicate controls inside the iframe", async () => {
    const { doc, snapshot, win } = await open(fragment);
    const controls = snapshot();
    expect(controls.carousels[0].variants.map((variant) => variant.label)).toEqual(["Expand", "Trace", "Connect"]);
    expect(controls.groups.map((group) => group.visible)).toEqual([true, false, false]);
    expect(controls.groups[0].controls.map((control) => control.type)).toEqual(["range", "color", "toggle", "select"]);
    expect(doc.querySelectorAll("button")).toHaveLength(3);
    expect(doc.querySelector("select, input, .viz-carousel-controls, .mains-viz-settings")).toBeNull();
    expect(win.tweaks.every((tweak: { supported: boolean }) => tweak.supported)).toBe(true);
  });

  it("switches variants by identity without replacing their DOM or starting animations", async () => {
    const { doc, snapshot, command } = await open(fragment);
    const carousel = snapshot().carousels[0];
    const first = doc.querySelector<HTMLElement>('[data-variant="Expand"]')!;
    first.querySelector<HTMLButtonElement>("button")!.click();
    const selected = await command({ type: "select-variant", carouselId: carousel.id, variantId: carousel.variants[2].id });
    expect(selected.groups.map((group) => group.visible)).toEqual([false, false, true]);
    expect(first.hidden).toBe(true);
    await command({ type: "select-variant", carouselId: carousel.id, variantId: carousel.variants[0].id });
    expect(doc.querySelector('[data-variant="Expand"]')).toBe(first);
    expect(first.dataset.played).toBe("true");
    expect(doc.querySelector('[data-variant="Connect"]')!.getAttribute("data-played")).toBeNull();
  });

  it("applies all control types and rejects invalid values and unknown identities", async () => {
    const { snapshot, command, win, doc } = await open(fragment);
    const group = snapshot().groups[0];
    for (const [index, value] of [700, "#abcdef80", false, "dark"].entries()) {
      await command({ type: "set-control", groupId: group.id, controlId: group.controls[index].id, value });
    }
    expect(win.settings[0]).toEqual({ duration: 700, color: "#abcdef80", enabled: false, appearance: "dark" });
    expect(doc.querySelector('[data-variant="Expand"]')!.getAttribute("data-duration")).toBe("700");
    await command({ type: "set-control", groupId: group.id, controlId: group.controls[0].id, value: 5000 });
    await command({ type: "set-control", groupId: "missing", controlId: group.controls[0].id, value: 800 });
    expect(win.settings[0].duration).toBe(700);
    expect(win.settings[1].duration).toBe(520);
  });

  it("restores edits after original preview and resets settings across hidden variants", async () => {
    const { snapshot, command, win } = await open(fragment);
    const before = snapshot();
    for (const group of before.groups.slice(0, 2)) await command({ type: "set-control", groupId: group.id, controlId: group.controls[0].id, value: 700 });
    const preview = await command({ type: "preview-original", active: true });
    expect(preview.previewing).toBe(true);
    expect(preview.groups[0].controls[0].value).toBe(700);
    expect(win.settings[0].duration).toBe(520);
    await command({ type: "preview-original", active: false });
    expect(win.settings[0].duration).toBe(700);
    await command({ type: "select-variant", carouselId: before.carousels[0].id, variantId: before.carousels[0].variants[2].id });
    await command({ type: "reset" });
    expect(win.settings.map((state: { duration: number }) => state.duration)).toEqual([520, 520, 520]);
  });

  it("tracks dynamic variants and retires removed or replaced component registrations", async () => {
    const { doc, snapshot, command, win } = await open(fragment);
    const old = snapshot().groups[0];
    const first = doc.querySelector('[data-variant="Expand"]')!;
    const replacement = new win.Tweak({ container: first });
    expect(() => replacement.addToggle({ size: 5 }, "size")).toThrow("valid current value");
    expect(win.tweaks[0].supported).toBe(true);
    const state = { size: 5 };
    replacement.addSlider(state, "size", { min: 0, max: 10 });
    await tick();
    expect(win.tweaks[0].supported).toBe(false);
    await command({ type: "set-control", groupId: old.id, controlId: old.controls[0].id, value: 800 });
    expect(win.settings[0].duration).toBe(520);
    expect(snapshot().groups.find((group) => group.visible)!.controls).toHaveLength(1);
    const extra = doc.createElement("section"); extra.dataset.variant = "New"; extra.hidden = true;
    doc.querySelector(".viz-carousel")!.append(extra);
    await tick();
    expect(snapshot().carousels[0].variants).toHaveLength(4);
    first.remove();
    await tick();
    expect(replacement.supported).toBe(false);
    expect(snapshot().groups.some((group) => group.label === "Expansion")).toBe(false);
    expect(snapshot().groups.find((group) => group.visible)!.label).toBe("Outline");
  });

  it("isolates multiple carousels, omits a single-design picker and stops bindings on teardown", async () => {
    const { snapshot, command, win } = await open(`${fragment}<div lang="en" class="viz-carousel"><div data-variant="Only">One</div></div>`);
    expect(snapshot().carousels).toHaveLength(1);
    const carousel = snapshot().carousels[0];
    await command({ type: "select-variant", carouselId: carousel.id, variantId: carousel.variants[1].id });
    expect(snapshot().groups[1].visible).toBe(true);
    win.dispatchEvent(new win.Event("pagehide"));
    expect(win.tweaks[0].supported).toBe(false);
    expect(() => win.tweaks[0].addToggle(win.settings[0], "enabled")).toThrow("disposed");
  });
});
