/// <reference lib="dom" />
import type {
  BrowserAnnotationTheme,
  BrowserSelectionElement,
} from "../../../shared/browser-annotation";

export const INSPECTOR_SENTINEL = "[[MAINS_BROWSER_SELECTION_V1]]";

// Self-contained: serialized into the guest page, which has no Node access or
// renderer bridge. The shadow root isolates controls from the page's styles.
function installInspector(enabled: boolean, sentinel: string, theme?: BrowserAnnotationTheme) {
  const guest = window as typeof window & {
    __mainsInspectorState__?: {
      active: boolean;
      teardown: () => void;
      finishCapture: (error?: string) => void;
    };
  };
  if (!enabled) { guest.__mainsInspectorState__?.teardown(); return "ok"; }
  if (guest.__mainsInspectorState__?.active) return "already-active";

  const host = document.createElement("div");
  host.setAttribute("data-mains-inspector", "1");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const { glass, ...colors } = theme ?? {
    surface: "Canvas", foreground: "CanvasText", muted: "GrayText",
    border: "GrayText", accent: "Highlight", accentForeground: "HighlightText",
    fontFamily: "system-ui, sans-serif",
  };
  for (const [key, value] of Object.entries(colors)) host.style.setProperty(`--mains-${key}`, value);
  const root = host.attachShadow({ mode: "open" });
  for (const eventName of ["click", "pointerdown", "mousedown", "pointerup", "mouseup", "input"]) {
    root.addEventListener(eventName, (event) => event.stopPropagation());
  }
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing:border-box; }
    .glass-outline { position:relative;border:0; }
    .glass-outline::before { content:"";position:absolute;inset:0;padding:1px;border-radius:inherit;
      pointer-events:none;background:${glass?.outline || "var(--mains-border)"};
      mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude; }
    .outline { position:fixed;pointer-events:none;border-radius:8px;
      background:color-mix(in srgb,var(--mains-accent) 5%,transparent); }
    .outline::before { background:${glass?.selectionOutline || "var(--mains-accent)"}; }
    .hover { background:color-mix(in srgb,var(--mains-accent) 9%,transparent); }
    .hover::before { opacity:.7; }
    .number { position:absolute;top:1px;left:1px;min-width:16px;padding:1px 4px;border-radius:7px 0 6px 0;
      background:var(--mains-accent);color:var(--mains-accentForeground);font:10px/14px var(--mains-fontFamily); }
    .label,.hint { position:fixed;border-radius:7px;padding:5px 8px;background:var(--mains-surface);
      color:var(--mains-foreground);font:11px/16px var(--mains-fontFamily); }
    .label { max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .hint { top:12px;left:50%;transform:translateX(-50%);white-space:nowrap; }
    .card { position:fixed;width:360px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);
      overflow:auto;pointer-events:auto;border-radius:18px;
      background:var(--mains-surface);color:var(--mains-foreground);padding:12px;
      font:12px/18px var(--mains-fontFamily); }
    .header,.footer { display:flex;align-items:center;justify-content:space-between;gap:8px; }
    .header { margin-bottom:8px;cursor:grab;touch-action:none; }
    .count { font-weight:500; }
    button,textarea { font:inherit; }
    button { cursor:pointer;border:0;color:inherit;background:transparent; }
    button:focus-visible { outline:1px solid var(--mains-accent);outline-offset:1px; }
    button:hover { background:color-mix(in srgb,var(--mains-foreground) 7%,transparent); }
    .close { display:grid;place-items:center;width:24px;height:24px;border-radius:50%;font-size:18px; }
    .chips { display:flex;flex-wrap:nowrap;gap:5px;overflow-x:auto;overflow-y:hidden;margin-bottom:8px;
      padding:1px 0 5px;overscroll-behavior-x:contain;scrollbar-width:thin;scrollbar-color:var(--mains-border) transparent; }
    .chip { display:flex;flex:0 0 auto;align-items:center;gap:5px;max-width:100%;min-width:0;
      padding:4px 6px;border-radius:9px; }
    .tag { flex-shrink:0;font:11px/16px ui-monospace,monospace;color:var(--mains-muted); }
    .text { max-width:175px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .chip button { flex-shrink:0;line-height:16px;width:16px;border-radius:4px; }
    .glass-input { background:${glass?.input || "var(--mains-surface)"};border:.5px solid transparent; }
    textarea { display:block;resize:none;width:100%;min-height:54px;max-height:140px;
      border-radius:12px;padding:8px 10px;color:var(--mains-foreground);outline:none;
      user-select:text;cursor:text; }
    textarea::placeholder { color:var(--mains-muted); }
    .footer { margin-top:8px; }
    .help { color:var(--mains-muted);font-size:10px; }
    .add { flex-shrink:0;border-radius:10px;padding:6px 10px;background:var(--mains-accent);
      color:var(--mains-accentForeground);font-weight:500; }
    .add:hover { background:var(--mains-accent);filter:brightness(1.08); }
    [hidden] { display:none !important; }
  `;
  root.appendChild(style);
  document.documentElement.appendChild(host);
  const pageStyle = document.createElement("style");
  pageStyle.setAttribute("data-mains-inspector", "1");
  pageStyle.textContent = "html[data-mains-inspect] *,html[data-mains-inspect] *::before,html[data-mains-inspect] *::after{cursor:crosshair!important}";
  (document.head || document.documentElement).appendChild(pageStyle);
  document.documentElement.setAttribute("data-mains-inspect", "1");

  function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: Node = root) {
    const element = document.createElement(tag);
    element.className = className;
    parent.appendChild(element);
    return element;
  }
  const highlights = node("div", "highlights");
  const hoverOutline = node("div", "glass-outline outline hover");
  const hoverLabel = node("div", "glass-outline label");
  hoverOutline.hidden = hoverLabel.hidden = true;
  const hint = node("div", "glass-outline hint");
  hint.textContent = "Click elements to annotate · Esc to exit";
  const card = node("div", "glass-outline card");
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Browser annotation");
  const header = node("div", "header", card);
  const count = node("span", "count", header);
  const discard = node("button", "close", header);
  discard.type = "button";
  discard.textContent = "×";
  discard.setAttribute("aria-label", "Discard selection");
  const chips = node("div", "chips", card);
  const comment = node("textarea", "glass-input comment", card);
  comment.placeholder = "Add a comment…";
  comment.setAttribute("aria-label", "Annotation comment");
  comment.maxLength = 4000;
  comment.rows = 2;
  const footer = node("div", "footer", card);
  const help = node("span", "help", footer);
  help.textContent = "Click more to select · Enter to add";
  help.setAttribute("aria-live", "polite");
  const add = node("button", "add", footer);
  add.type = "button";
  add.textContent = "Add to chat";

  let selected: Element[] = [];
  let hovered: Element | null = null;
  let capturePending = false;
  let captureTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let draggedPosition: { x: number; y: number } | null = null;
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  let active = true;

  function emit(payload: unknown) { console.log(sentinel + JSON.stringify(payload)); }
  function own(event: Event) { return event.composedPath().includes(host); }
  function cssEscape(value: string) {
    return typeof window.CSS?.escape === "function" ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function selector(element: Element) {
    if (element.id) return "#" + cssEscape(element.id);
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) { parts.unshift(part + "#" + cssEscape(current.id)); break; }
      const classes = Array.from(current.classList).slice(0, 2).map(cssEscape);
      if (classes.length) part += "." + classes.join(".");
      if (current.parentElement) {
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) index++;
          sibling = sibling.previousElementSibling;
        }
        part += `:nth-of-type(${index})`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }
  function describe(element: Element): BrowserSelectionElement {
    const rect = element.getBoundingClientRect();
    const styles: Record<string, string> = {};
    const computed = getComputedStyle(element);
    for (const key of ["color", "backgroundColor", "fontSize", "fontWeight", "borderRadius", "padding", "margin", "display"]) {
      styles[key] = computed[key as keyof CSSStyleDeclaration] as string;
    }
    let componentName: string | undefined;
    let sourceFile: string | undefined;
    let current: Element | null = element;
    while (current) {
      componentName ||= current.getAttribute("data-component-name") || undefined;
      sourceFile ||= current.getAttribute("data-source-file") || undefined;
      if (componentName && sourceFile) break;
      current = current.parentElement;
    }
    const text = ((element as HTMLElement).innerText || element.textContent || "")
      .replace(/\s+/g, " ").trim().slice(0, 600);
    return {
      selector: selector(element), tagName: element.tagName.toLowerCase(), text, styles,
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      pageRect: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
      scroll: { x: window.scrollX, y: window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio || 1, componentName, sourceFile,
    };
  }
  function placeOutline(outline: HTMLElement, element: Element) {
    const rect = element.getBoundingClientRect();
    Object.assign(outline.style, {
      top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }
  function positionCard() {
    if (!selected.length || capturePending) return;
    const rect = selected[0].getBoundingClientRect();
    const width = card.offsetWidth || Math.min(360, window.innerWidth - 24);
    const height = card.offsetHeight || 175;
    const below = rect.bottom + 12;
    const left = draggedPosition?.x ?? rect.left;
    const top = draggedPosition?.y ?? (below + height < window.innerHeight ? below : rect.top - height - 12);
    card.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
    card.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
  }
  function layout() {
    highlights.replaceChildren();
    selected.forEach((element, index) => {
      const outline = node("div", "glass-outline outline", highlights);
      placeOutline(outline, element);
      const number = node("span", "number", outline);
      number.textContent = String(index + 1);
    });
    if (hovered?.isConnected && !selected.includes(hovered) && !capturePending) {
      placeOutline(hoverOutline, hovered);
      hoverOutline.hidden = hoverLabel.hidden = false;
      const rect = hovered.getBoundingClientRect();
      hoverLabel.textContent = `${hovered.tagName.toLowerCase()} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
      hoverLabel.style.top = `${Math.max(4, rect.top - 28)}px`;
      hoverLabel.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - 140))}px`;
    } else hoverOutline.hidden = hoverLabel.hidden = true;
    positionCard();
  }
  function renderSelection() {
    selected = selected.filter((element) => element.isConnected);
    chips.replaceChildren();
    count.textContent = `${selected.length} selected item${selected.length === 1 ? "" : "s"}`;
    selected.forEach((element, index) => {
      const details = describe(element);
      const chip = node("div", "glass-outline chip", chips);
      const tag = node("span", "tag", chip);
      tag.textContent = details.tagName;
      const text = node("span", "text", chip);
      text.textContent = details.componentName || details.text || details.selector;
      chip.title = details.selector;
      const remove = node("button", "", chip);
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove selected item ${index + 1}`);
      remove.onclick = () => {
        if (capturePending) return;
        selected = selected.filter((candidate) => candidate !== element);
        renderSelection();
      };
    });
    card.hidden = !selected.length || capturePending;
    hint.hidden = !!selected.length || capturePending;
    if (!selected.length) { comment.value = ""; draggedPosition = null; }
    layout();
  }
  function finishCapture(error?: string) {
    if (captureTimer) clearTimeout(captureTimer);
    capturePending = false;
    if (!error) { selected = []; comment.value = ""; draggedPosition = null; }
    help.textContent = error || "Click more to select · Enter to add";
    renderSelection();
    if (error) comment.focus({ preventScroll: true });
  }
  function submit() {
    if (capturePending) return;
    selected = selected.filter((element) => element.isConnected);
    if (!selected.length) { renderSelection(); return; }
    const elements = selected.map(describe);
    const payload = {
      ...elements[0], type: "browser_selection", url: location.href, title: document.title || "",
      elements, comment: comment.value.trim(), timestamp: new Date().toISOString(),
    };
    capturePending = true;
    card.hidden = hint.hidden = hoverOutline.hidden = hoverLabel.hidden = true;
    // Paint the hidden editor before main captures the highlighted viewport.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!active || !capturePending) return;
      emit(payload);
      captureTimer = setTimeout(() => finishCapture("Capture timed out. Try adding the annotation again."), 15000);
    }));
  }
  add.onclick = submit;
  discard.onclick = () => { if (!capturePending) finishCapture(); };

  function onMove(event: MouseEvent) {
    if (capturePending || own(event)) { hovered = null; layout(); return; }
    const element = event.target instanceof Element ? event.target : null;
    if (hovered !== element) { hovered = element; layout(); }
  }
  function blockPagePointer(event: Event) {
    if (own(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function onClick(event: MouseEvent) {
    if (own(event)) return;
    blockPagePointer(event);
    if (capturePending || !(event.target instanceof Element)) return;
    const element = event.target;
    if (selected.includes(element)) selected = selected.filter((candidate) => candidate !== element);
    else if (selected.length < 30) selected.push(element);
    else { help.textContent = "Add this annotation before selecting more than 30 items."; return; }
    hovered = null;
    renderSelection();
    if (selected.length) comment.focus({ preventScroll: true });
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      emit({ cancel: true });
      teardown();
    }
    if (own(event)) {
      // Typing a comment must never trigger the guest application's shortcuts.
      event.stopImmediatePropagation();
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && root.activeElement === comment) {
        event.preventDefault();
        submit();
      }
    }
  }
  function onLayout() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = 0; if (active) layout(); });
  }
  header.onpointerdown = (event) => {
    if (event.target === discard) return;
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    header.setPointerCapture(event.pointerId);
  };
  header.onpointermove = (event) => {
    if (!drag) return;
    draggedPosition = { x: drag.left + event.clientX - drag.x, y: drag.top + event.clientY - drag.y };
    positionCard();
  };
  header.onpointerup = header.onpointercancel = () => { drag = null; };

  function teardown() {
    active = false;
    if (frame) cancelAnimationFrame(frame);
    if (captureTimer) clearTimeout(captureTimer);
    host.remove();
    pageStyle.remove();
    document.documentElement.removeAttribute("data-mains-inspect");
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseover", onMove, true);
    document.removeEventListener("pointerdown", blockPagePointer, true);
    document.removeEventListener("mousedown", blockPagePointer, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("scroll", onLayout, true);
    window.removeEventListener("resize", onLayout);
    delete guest.__mainsInspectorState__;
  }
  guest.__mainsInspectorState__ = { active: true, teardown, finishCapture };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseover", onMove, true);
  document.addEventListener("pointerdown", blockPagePointer, true);
  document.addEventListener("mousedown", blockPagePointer, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("scroll", onLayout, true);
  window.addEventListener("resize", onLayout);
  return "installed";
}

export function buildInspectorScript(enable: boolean, theme?: BrowserAnnotationTheme): string {
  return `(${installInspector.toString()})(${JSON.stringify(enable)},${JSON.stringify(INSPECTOR_SENTINEL)},${JSON.stringify(theme) ?? "undefined"});`;
}

/** Restore a failed draft or clear a completed group while annotation stays on. */
export function buildInspectorCaptureCompleteScript(error?: string): string {
  return `window.__mainsInspectorState__?.finishCapture(${JSON.stringify(error) ?? "undefined"});`;
}
