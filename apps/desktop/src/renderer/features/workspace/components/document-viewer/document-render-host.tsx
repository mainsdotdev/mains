import { useEffect, useRef, useState } from "react";
import { Text } from "@/components/ui";
import { useLocalDocumentUrl } from "@/hooks/use-local-document-url";
import { pickRenderer, type OfficeDocType } from "@/lib/document-viewer";
import type { DocumentViewerDoc } from "@/lib/redux/slices/appSettingsSlice";
import { DocumentFallback } from "./document-fallback";
import { SheetTabs } from "./sheet-tabs";
import type { PptxRenderController } from "./renderers/render-pptx";

type Status = "loading" | "ready" | "error";

// Base styles injected into the shadow root. The shadow boundary blocks the
// app's Tailwind CSS, but inherited properties (color/font) still flow in from
// the dark-themed host — so we pin readable defaults and style xlsx tables here
// (docx-preview and pptx-preview emit their own styles).
const BASE_SHADOW_CSS = `
:host {
  display: block;
  height: 100%;
  min-height: 0;
}
.doc-zoom-wrapper {
  color: #111;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  transform-origin: top left;
}
.doc-presentation-wrapper {
  width: 100%;
  height: 100%;
  min-height: 0;
  color: #111;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
.pptx-stage {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #101010;
}
.pptx-stage-scroller {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-color: #4b4b4b transparent;
}
.pptx-stage-scroller:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.48);
  outline-offset: -2px;
}
.pptx-stage-surface {
  box-sizing: border-box;
  width: max-content;
  min-width: 100%;
  min-height: 100%;
  padding: 28px 32px 36px;
}
.pptx-render-root {
  width: max-content;
  margin: 0 auto;
}
.pptx-render-root .pptx-preview-wrapper {
  height: auto !important;
  margin: 0 auto !important;
  overflow: visible !important;
  background: transparent !important;
}
.pptx-render-root .pptx-preview-slide-wrapper {
  margin: 0 auto 28px !important;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 16px 45px rgba(0, 0, 0, 0.34);
  scroll-margin: 28px;
}
.pptx-render-root .pptx-preview-slide-wrapper:last-child {
  margin-bottom: 0 !important;
}
.pptx-thumbnail-rail {
  box-sizing: border-box;
  flex: 0 0 auto;
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 18, 0.97);
  scrollbar-width: none;
}
.pptx-thumbnail-rail::-webkit-scrollbar {
  display: none;
}
.pptx-thumbnail-track {
  box-sizing: border-box;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  width: max-content;
  min-width: 100%;
  padding: 10px 18px 8px;
}
.pptx-thumbnail-button {
  appearance: none;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 3px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #888;
  font: inherit;
  cursor: pointer;
}
.pptx-thumbnail-button:hover {
  color: #d4d4d4;
}
.pptx-thumbnail-button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.65);
  outline-offset: 2px;
}
.pptx-thumbnail-viewport {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: 3px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14), 0 4px 12px rgba(0, 0, 0, 0.28);
}
.pptx-thumbnail-button.is-active .pptx-thumbnail-viewport {
  box-shadow: 0 0 0 2px #f4f4f5, 0 4px 14px rgba(0, 0, 0, 0.4);
}
.pptx-thumbnail-button.is-active {
  color: #f4f4f5;
}
.pptx-thumbnail-number {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.pptx-thumbnail-slide {
  position: absolute !important;
  inset: 0 auto auto 0;
  overflow: hidden;
  background: #fff;
}
.xlsx-sheet {
  background: #fff;
  min-width: 100%;
  overflow: visible;
}
.xlsx-sheet-table {
  border-collapse: collapse;
  table-layout: fixed;
  width: max-content;
  min-width: 100%;
  font-size: 13px;
  background: #fff;
}
.xlsx-sheet-table td {
  border: 1px solid #d4d4d4;
  box-sizing: border-box;
  min-width: 40px;
  min-height: 22px;
  padding: 3px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xlsx-sheet-table a { color: #2563eb; text-decoration: underline; }
`;

/**
 * Renders an Office document's bytes into a shadow root. Text formats never
 * reach here — the panel routes them to a React renderer, which is why this
 * component narrows `docType` to the Office set.
 */
export function DocumentRenderHost({
  doc,
  zoom,
}: {
  doc: DocumentViewerDoc & { docType: OfficeDocType };
  zoom: number;
}) {
  const url = useLocalDocumentUrl(doc.path);
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  const pptxCtlRef = useRef<PptxRenderController | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const sheetCtlRef = useRef<{ showSheet: (name: string) => void } | null>(
    null,
  );

  // Attach the shadow root exactly once for the lifetime of the host node.
  useEffect(() => {
    const host = hostRef.current;
    if (host && !shadowRootRef.current) {
      shadowRootRef.current = host.attachShadow({ mode: "open" });
    }
  }, []);

  // Render whenever the signed URL or target document changes.
  useEffect(() => {
    const root = shadowRootRef.current;
    if (!url || !root) {
      setStatus("loading");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setStatus("loading");
    setSheetNames([]);
    setActiveSheet(null);
    sheetCtlRef.current = null;
    pptxCtlRef.current?.destroy();
    pptxCtlRef.current = null;

    void (async () => {
      // Reset shadow content and rebuild the zoom wrapper.
      root.replaceChildren();
      const style = document.createElement("style");
      style.textContent = BASE_SHADOW_CSS;
      root.appendChild(style);
      const wrapper = document.createElement("div");
      const isPresentation = doc.docType === "pptx";
      wrapper.className = isPresentation
        ? "doc-presentation-wrapper"
        : "doc-zoom-wrapper";
      if (!isPresentation) {
        wrapper.style.transform = `scale(${zoomRef.current})`;
      }
      root.appendChild(wrapper);
      wrapperRef.current = wrapper;

      let buf: ArrayBuffer;
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        buf = await res.arrayBuffer();
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!cancelled) {
          console.error(`[document-viewer] failed to fetch ${doc.path}`, err);
          setStatus("error");
        }
        return;
      }
      if (cancelled) return;

      try {
        const key = pickRenderer(doc.docType);
        if (key === "docx") {
          const { renderDocx } = await import("./renderers/render-docx");
          await renderDocx(buf, wrapper);
        } else if (key === "xlsx") {
          const { renderXlsx } = await import("./renderers/render-xlsx");
          const ctl = await renderXlsx(buf, wrapper);
          if (cancelled) return;
          sheetCtlRef.current = ctl;
          setSheetNames(ctl.sheetNames);
          setActiveSheet(ctl.sheetNames[0] ?? null);
        } else {
          const { renderPptx } = await import("./renderers/render-pptx");
          const width = hostRef.current?.clientWidth || 960;
          const ctl = await renderPptx(buf, wrapper, {
            width,
            zoom: zoomRef.current,
          });
          if (cancelled) {
            ctl.destroy();
            return;
          }
          pptxCtlRef.current = ctl;
        }
        if (cancelled) return;
        // Treat an empty render as a failure (pure-JS PPTX can silently produce
        // nothing) so the fallback "Open with…" path kicks in.
        if (wrapper.childNodes.length === 0) throw new Error("empty render");
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          console.error(
            `[document-viewer] failed to render ${doc.docType} ${doc.path}`,
            err,
          );
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      pptxCtlRef.current?.destroy();
      pptxCtlRef.current = null;
    };
  }, [url, doc.path, doc.docType]);

  // Apply zoom imperatively so changing it doesn't re-render the document.
  useEffect(() => {
    zoomRef.current = zoom;
    if (pptxCtlRef.current) {
      pptxCtlRef.current.setZoom(zoom);
    } else if (wrapperRef.current) {
      wrapperRef.current.style.transform = `scale(${zoom})`;
    }
  }, [zoom]);

  const onSelectSheet = (name: string) => {
    setActiveSheet(name);
    sheetCtlRef.current?.showSheet(name);
  };

  const isPresentation = doc.docType === "pptx";

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-primary-100 dark:bg-primary-900">
      <div
        className={`relative flex-1 min-h-0 ${
          isPresentation ? "overflow-hidden" : "overflow-auto p-3"
        }`}
      >
        <div
          ref={hostRef}
          className={isPresentation ? "h-full min-h-0" : "min-h-full"}
        />
        {status === "loading" && (
          <Text
            as="div"
            size="xs"
            tone="faint"
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            Loading document…
          </Text>
        )}
        {status === "error" && (
          <div className="absolute inset-0">
            <DocumentFallback doc={doc} />
          </div>
        )}
      </div>
      {status === "ready" && doc.docType === "xlsx" && (
        <SheetTabs
          sheetNames={sheetNames}
          active={activeSheet}
          onSelect={onSelectSheet}
        />
      )}
    </div>
  );
}
