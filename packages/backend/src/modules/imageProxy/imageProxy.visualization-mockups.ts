/// <reference lib="dom" />
import type { VisualizationControls, VisualizationCommand, VisualizationDesignControl, VisualizationValue } from "@mains/contracts/visualization";

// Serialized before fragment scripts. All runtime dependencies must be local.
// React owns the controls; this sandbox owns only DOM visibility and bindings.
function installMockupRuntime(win: Window & typeof globalThis): void {
  type Options = {
    label?: string; reference?: string; unit?: string; min?: number; max?: number; step?: number;
    options?: Array<string | { label: string; value: string }>;
  };
  type Binding = {
    id: string; object: Record<string, VisualizationValue>; property: string;
    type: string; options: Options; initial: VisualizationValue; value: VisualizationValue;
  };
  type Panel = { id: string; target: Element; onChange?: () => void; bindings: Binding[]; disposed: boolean };
  type Carousel = { id: string; target: Element; variants: HTMLElement[] };
  const { document } = win;
  const panels = new Set<Panel>();
  const carousels = new Map<Element, Carousel>();
  const variantIds = new WeakMap<Element, string>();
  const listeners = new win.AbortController();
  let nextId = 0;
  let root: HTMLElement | null = null;
  let stopped = false;
  let scheduled = false;
  let previewing = false;
  let lastSnapshot = "";

  function label(value: string | null | undefined, fallback: string): string {
    return (value?.trim() || fallback).slice(0, 200);
  }

  function apply(panel: Panel, binding: Binding, value: VisualizationValue): void {
    if (panel.disposed || !panel.target.isConnected) return;
    binding.object[binding.property] = value;
    try { panel.onChange?.(); } catch (error) { win.console.error(error); }
  }

  function preview(active: boolean): void {
    if (previewing === active) return;
    previewing = active;
    for (const panel of panels) for (const binding of panel.bindings) {
      if (binding.value !== binding.initial) apply(panel, binding, active ? binding.initial : binding.value);
    }
  }

  function valid(type: string, value: unknown, options: Options): value is VisualizationValue {
    if (type === "range") return typeof value === "number" && Number.isFinite(value)
      && Number.isFinite(options.min) && Number.isFinite(options.max)
      && options.min! < options.max! && value >= options.min! && value <= options.max!
      && Number.isFinite(options.step ?? 1) && (options.step ?? 1) > 0;
    if (type === "color") return typeof value === "string" && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
    if (type === "toggle") return typeof value === "boolean";
    return typeof value === "string" && !!options.options?.some((option) => (typeof option === "string" ? option : option.value) === value);
  }

  function catalog(force = false): void {
    if (!root || stopped) return;
    const language = root.querySelector("[lang]")?.getAttribute("lang") || win.navigator.language;
    const snapshot: VisualizationControls = {
      language: language?.startsWith("tr") ? "tr" : "en",
      previewing,
      carousels: Array.from(carousels.values()).filter((carousel) => carousel.variants.length > 1 && !carousel.target.closest("[hidden]")).map((carousel) => ({
        id: carousel.id, label: label(carousel.target.getAttribute("aria-label"), "Designs"),
        previousLabel: label(carousel.target.getAttribute("data-previous-label"), language?.startsWith("tr") ? "Önceki seçenek" : "Previous variant"),
        nextLabel: label(carousel.target.getAttribute("data-next-label"), language?.startsWith("tr") ? "Sonraki seçenek" : "Next variant"),
        selectedId: variantIds.get(carousel.variants.find((variant) => !variant.hidden)!)!,
        variants: carousel.variants.map((variant) => ({ id: variantIds.get(variant)!, label: label(variant.dataset.variant, "Design") })),
      })),
      groups: Array.from(panels).map((panel) => ({
        id: panel.id, label: label(panel.target.getAttribute("aria-label") || panel.target.id, "Component"),
        visible: !panel.target.closest("[hidden]"),
        ...(panel.target.closest("[data-variant]") ? { variant: label(panel.target.closest("[data-variant]")!.getAttribute("data-variant"), "Design") } : {}),
        controls: panel.bindings.map((binding) => {
          const base = { id: binding.id, label: label(binding.options.label, binding.property),
            value: binding.value, initialValue: binding.initial,
            ...(binding.options.reference ? { reference: binding.options.reference.slice(0, 200) } : {}) };
          if (binding.type === "range") return { ...base, type: "range", min: binding.options.min!, max: binding.options.max!, step: binding.options.step ?? 1,
            ...(binding.options.unit ? { unit: binding.options.unit.slice(0, 30) } : {}) } as VisualizationDesignControl;
          if (binding.type === "select") return { ...base, type: "select", options: binding.options.options!.map((option) =>
            typeof option === "string" ? { label: option, value: option } : option) } as VisualizationDesignControl;
          return { ...base, type: binding.type } as VisualizationDesignControl;
        }),
      })),
    };
    const serialized = JSON.stringify(snapshot);
    if (!force && serialized === lastSnapshot) return;
    lastSnapshot = serialized;
    win.dispatchEvent(new win.CustomEvent("mains:visualization-controls", { detail: snapshot }));
  }

  function refresh(): void {
    scheduled = false;
    if (stopped || !root) return;
    for (const [target] of carousels) if (!target.isConnected || !root.contains(target)) carousels.delete(target);
    for (const target of Array.from(root.querySelectorAll(".viz-carousel")).slice(0, 16)) {
      let carousel = carousels.get(target);
      if (!carousel) { carousel = { id: `carousel-${++nextId}`, target, variants: [] }; carousels.set(target, carousel); }
      carousel.variants = Array.from(target.children).filter((child): child is HTMLElement =>
        child instanceof win.HTMLElement && child.hasAttribute("data-variant")).slice(0, 32);
      const active = Math.max(0, carousel.variants.findIndex((variant) => !variant.hidden));
      carousel.variants.forEach((variant, i) => {
        if (!variantIds.has(variant)) variantIds.set(variant, `variant-${++nextId}`);
        if (variant.hidden !== (i !== active)) variant.hidden = i !== active;
      });
    }
    for (const panel of panels) if (!panel.target.isConnected) { panel.disposed = true; panels.delete(panel); }
    catalog();
  }

  function schedule(): void {
    if (stopped || scheduled) return;
    scheduled = true;
    win.queueMicrotask(refresh);
  }

  (win as typeof win & { Tweak?: unknown }).Tweak = function Tweak({ container, onChange }: { container: Element; onChange?: () => void }) {
    if (!(container instanceof win.Element) || container.ownerDocument !== document) throw new TypeError("Tweak needs a component element");
    const panel: Panel = { id: `group-${++nextId}`, target: container, onChange, bindings: [], disposed: false };
    function bind(object: Record<string, VisualizationValue>, property: string, type: string, options: Options = {}) {
      if (panel.disposed || stopped) throw new Error("Tweak has been disposed");
      if (panel.bindings.length >= 12 || (!panels.has(panel) && panels.size >= 64
        && !Array.from(panels).some((previous) => previous.target === container))) throw new RangeError("Too many Tweak controls");
      if (options.options && (options.options.length > 12 || options.options.some((option) =>
        typeof option === "string" ? !option.trim() || option.length > 200
          : typeof option?.label !== "string" || !option.label.trim() || option.label.length > 200
            || typeof option?.value !== "string" || !option.value.trim() || option.value.length > 200))) throw new TypeError("Invalid Tweak options");
      if (!valid(type, object[property], options)) throw new TypeError("Tweak bindings require a valid current value");
      if (options.options && new Set(options.options.map((option) => typeof option === "string" ? option : option.value)).size !== options.options.length) throw new TypeError("Tweak options must have unique values");
      const snapshot = JSON.parse(JSON.stringify(options)) as Options;
      if (!panels.has(panel)) for (const previous of panels) if (previous.target === container) {
        preview(false); previous.disposed = true; panels.delete(previous);
      }
      panel.bindings.push({ id: `control-${++nextId}`, object, property, type, options: snapshot, initial: object[property], value: object[property] });
      panels.add(panel);
      schedule();
      return api;
    }
    const api = {
      get supported() { return !stopped && !panel.disposed; },
      addSlider: (object: Record<string, VisualizationValue>, property: string, options: Options) => bind(object, property, "range", options),
      addColorPicker: (object: Record<string, VisualizationValue>, property: string, options?: Options) => bind(object, property, "color", options),
      addToggle: (object: Record<string, VisualizationValue>, property: string, options?: Options) => bind(object, property, "toggle", options),
      addSelect: (object: Record<string, VisualizationValue>, property: string, options: Options) => bind(object, property, "select", options),
      dispose() { preview(false); panel.disposed = true; panels.delete(panel); schedule(); },
    };
    return api;
  };

  win.addEventListener("mains:visualization-command", (event) => {
    if (stopped) return;
    const command = (event as CustomEvent<VisualizationCommand>).detail;
    if (!command || typeof command !== "object") return;
    if (command.type === "preview-original") {
      if (typeof command.active === "boolean") preview(command.active);
    } else if (command.type === "reset") {
      preview(false);
      for (const panel of panels) for (const binding of panel.bindings) {
        if (binding.value === binding.initial) continue;
        binding.value = binding.initial; apply(panel, binding, binding.initial);
      }
    } else if (command.type === "select-variant") {
      const carousel = Array.from(carousels.values()).find((item) => item.id === command.carouselId && item.target.isConnected);
      if (!carousel?.variants.some((variant) => variantIds.get(variant) === command.variantId && variant.isConnected)) return;
      preview(false);
      carousel.variants.forEach((variant) => { variant.hidden = variantIds.get(variant) !== command.variantId; });
    } else if (command.type === "set-control") {
      const panel = Array.from(panels).find((item) => item.id === command.groupId && !item.disposed && item.target.isConnected);
      const binding = panel?.bindings.find((item) => item.id === command.controlId);
      if (!panel || !binding || !valid(binding.type, command.value, binding.options)) return;
      preview(false); binding.value = command.value; apply(panel, binding, command.value);
    }
    refresh();
  }, { signal: listeners.signal });
  win.addEventListener("openai:set_globals", () => { refresh(); catalog(true); }, { signal: listeners.signal });
  const observer = new win.MutationObserver(schedule);
  function start(): void {
    root = document.getElementById("mains-visualization-root");
    if (!root || stopped) return;
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "data-variant", "aria-label"] });
    refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  win.addEventListener("pagehide", () => {
    preview(false); stopped = true; observer.disconnect(); listeners.abort(); panels.clear(); carousels.clear();
  }, { once: true });
}

export const VISUALIZATION_MOCKUP_SCRIPT = `(${installMockupRuntime.toString()})(window);`;
export const VISUALIZATION_MOCKUP_CSS = String.raw`
.viz-dotted-background {
  background-image: radial-gradient(circle, color-mix(in srgb, var(--foreground) 20%, transparent) .8px, transparent .8px);
  background-size: 16px 16px;
  background-position: 8px 8px;
}
.viz-carousel { min-width: 0; }
.viz-carousel > [data-variant][hidden] { display: none !important; }
`;
