// Inspector script injected into the browser view's page.
// When select mode is active, overlays a highlight on hover and captures
// structural context on click, then emits it via console.log with a sentinel
// prefix that the main process parses.

export const INSPECTOR_SENTINEL = "[[MAINS_BROWSER_SELECTION_V1]]";

/**
 * Returns the IIFE source that, when executeJavaScript'd into a page,
 * installs or updates the inspector in the requested mode.
 *
 * enable=true  -> installs overlay + click capture
 * enable=false -> removes overlay + listeners
 */
export function buildInspectorScript(enable: boolean): string {
  return `(function() {
  var SENTINEL = ${JSON.stringify(INSPECTOR_SENTINEL)};
  var STATE_KEY = "__mainsInspectorState__";
  var state = window[STATE_KEY];

  function teardown() {
    if (!state) return;
    try {
      if (state.overlay && state.overlay.parentNode) state.overlay.parentNode.removeChild(state.overlay);
      if (state.label && state.label.parentNode) state.label.parentNode.removeChild(state.label);
      if (state.styleTag && state.styleTag.parentNode) state.styleTag.parentNode.removeChild(state.styleTag);
    } catch (_) {}
    try { document.documentElement.removeAttribute("data-mains-inspect"); } catch (_) {}
    try {
      document.removeEventListener("mousemove", state.onMove, true);
      document.removeEventListener("click", state.onClick, true);
      document.removeEventListener("keydown", state.onKey, true);
      document.removeEventListener("mouseover", state.onOver, true);
      document.removeEventListener("scroll", state.onScroll, true);
    } catch (_) {}
    delete window[STATE_KEY];
  }

  if (!${enable}) { teardown(); return "ok"; }
  if (state && state.active) return "already-active";

  teardown();

  var style = document.createElement("style");
  style.setAttribute("data-mains-inspector", "1");
  style.textContent = [
    "html[data-mains-inspect] *, html[data-mains-inspect] *::before, html[data-mains-inspect] *::after { cursor: crosshair !important; }",
    "html[data-mains-inspect] { -webkit-user-select: none !important; user-select: none !important; }"
  ].join("\\n");
  (document.head || document.documentElement).appendChild(style);

  var overlay = document.createElement("div");
  overlay.setAttribute("data-mains-inspector-overlay", "1");
  overlay.style.cssText = [
    "position:fixed",
    "pointer-events:none",
    "z-index:2147483646",
    "border:2px solid #4f8cff",
    "background:rgba(79,140,255,0.16)",
    "box-shadow:0 0 0 9999px rgba(12,16,28,0.10)",
    "border-radius:4px",
    "transition:top 60ms linear,left 60ms linear,width 60ms linear,height 60ms linear",
    "top:-9999px",
    "left:-9999px",
    "width:0",
    "height:0",
    "display:none"
  ].join(";");
  document.documentElement.appendChild(overlay);

  var label = document.createElement("div");
  label.style.cssText = [
    "position:fixed",
    "pointer-events:none",
    "z-index:2147483647",
    "background:#111827",
    "color:#e5e7eb",
    "font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace",
    "padding:3px 6px",
    "border-radius:4px",
    "box-shadow:0 2px 8px rgba(0,0,0,0.3)",
    "top:-9999px",
    "left:-9999px",
    "max-width:60vw",
    "white-space:nowrap",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "display:none"
  ].join(";");
  document.documentElement.appendChild(label);

  document.documentElement.setAttribute("data-mains-inspect", "1");

  function isOwnElement(el) {
    return el === overlay || el === label || (el && el.closest && (el.closest("[data-mains-inspector-overlay]") || el.closest("[data-mains-inspector]") || el.closest("[data-mains-selection-marker]")));
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + cssEscape(el.id);
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      var seg = cur.nodeName.toLowerCase();
      if (cur.id) { parts.unshift(seg + "#" + cssEscape(cur.id)); break; }
      if (cur.classList && cur.classList.length) {
        var cls = Array.prototype.slice.call(cur.classList, 0, 2).map(cssEscape).join(".");
        if (cls) seg += "." + cls;
      }
      var parent = cur.parentElement;
      if (parent) {
        var idx = 1, sib = cur;
        while ((sib = sib.previousElementSibling)) if (sib.nodeName === cur.nodeName) idx++;
        seg += ":nth-of-type(" + idx + ")";
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function findMeta(el) {
    var cur = el, componentName, sourceFile;
    while (cur && cur.nodeType === 1) {
      if (!componentName && cur.getAttribute) componentName = cur.getAttribute("data-component-name") || undefined;
      if (!sourceFile && cur.getAttribute) sourceFile = cur.getAttribute("data-source-file") || undefined;
      if (componentName && sourceFile) break;
      cur = cur.parentElement;
    }
    return { componentName: componentName, sourceFile: sourceFile };
  }

  function pickStyles(el) {
    try {
      var cs = window.getComputedStyle(el);
      var keys = ["color","backgroundColor","fontSize","fontWeight","borderRadius","padding","margin","display"];
      var out = {};
      for (var i = 0; i < keys.length; i++) out[keys[i]] = cs[keys[i]];
      return out;
    } catch (_) { return {}; }
  }

  function trim(str, max) {
    if (!str) return "";
    str = String(str);
    if (str.length <= max) return str;
    return str.slice(0, max) + "…";
  }

  function moveOverlayTo(el) {
    if (!el) { overlay.style.display = "none"; label.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.top = r.top + "px";
    overlay.style.left = r.left + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";

    var tag = el.nodeName.toLowerCase();
    var id = el.id ? "#" + el.id : "";
    var cls = el.classList && el.classList.length ? "." + Array.prototype.slice.call(el.classList, 0, 2).join(".") : "";
    label.textContent = tag + id + cls + "  " + Math.round(r.width) + "×" + Math.round(r.height);
    label.style.display = "block";
    var ly = r.top - 20;
    if (ly < 4) ly = r.bottom + 4;
    label.style.top = ly + "px";
    label.style.left = Math.max(4, r.left) + "px";
  }

  var hovered = null;
  function onMove(e) {
    var el = e.target;
    if (!el || isOwnElement(el)) return;
    if (el !== hovered) { hovered = el; moveOverlayTo(el); }
  }
  function onOver(e) {
    var el = e.target;
    if (!el || isOwnElement(el)) return;
    if (el !== hovered) { hovered = el; moveOverlayTo(el); }
  }
  function onScroll() { if (hovered) moveOverlayTo(hovered); }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      emit({ cancel: true });
      teardown();
    }
  }

  function emit(obj) {
    try { console.log(SENTINEL + JSON.stringify(obj)); } catch (_) {}
  }

  function placeMarker(el, rect) {
    var marker = document.createElement("div");
    marker.setAttribute("data-mains-selection-marker", "1");
    var pageTop = rect.top + window.scrollY;
    var pageLeft = rect.left + window.scrollX;
    marker.style.cssText = [
      "position:absolute",
      "pointer-events:none",
      "z-index:2147483645",
      "border:2px solid #4f8cff",
      "background:rgba(79,140,255,0.08)",
      "border-radius:4px",
      "box-sizing:border-box",
      "top:" + pageTop + "px",
      "left:" + pageLeft + "px",
      "width:" + rect.width + "px",
      "height:" + rect.height + "px"
    ].join(";");
    var tag = el.nodeName.toLowerCase();
    var id = el.id ? "#" + el.id : "";
    var cls = el.classList && el.classList.length ? "." + Array.prototype.slice.call(el.classList, 0, 2).join(".") : "";
    var badge = document.createElement("div");
    badge.textContent = tag + id + cls;
    badge.style.cssText = [
      "position:absolute",
      "top:-18px",
      "left:-2px",
      "background:#4f8cff",
      "color:#fff",
      "font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace",
      "padding:1px 5px",
      "border-radius:3px 3px 3px 0",
      "white-space:nowrap",
      "pointer-events:none"
    ].join(";");
    marker.appendChild(badge);
    document.documentElement.appendChild(marker);
  }

  function onClick(e) {
    var el = e.target;
    if (!el || isOwnElement(el)) return;
    e.preventDefault();
    e.stopPropagation();

    var rect = el.getBoundingClientRect();
    var meta = findMeta(el);
    var text = trim((el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim(), 600);

    placeMarker(el, rect);

    var payload = {
      type: "browser_selection",
      url: location.href,
      title: document.title || "",
      selector: buildSelector(el),
      tagName: el.nodeName.toLowerCase(),
      text: text,
      styles: pickStyles(el),
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      pageRect: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
      scroll: { x: window.scrollX, y: window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio || 1,
      componentName: meta.componentName,
      sourceFile: meta.sourceFile,
      timestamp: new Date().toISOString()
    };
    emit(payload);
    teardown();
  }

  state = { active: true, overlay: overlay, label: label, styleTag: style, onMove: onMove, onOver: onOver, onClick: onClick, onKey: onKey, onScroll: onScroll };
  window[STATE_KEY] = state;

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("scroll", onScroll, true);

  return "installed";
})();`;
}
