import { useEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Text } from "@/components/ui";
import { useLocalDocumentUrl } from "@/hooks/use-local-document-url";
import type { DocumentViewerDoc } from "@/lib/redux/slices/appSettingsSlice";
import { DocumentFallback } from "./document-fallback";

type Status = "loading" | "ready" | "error";
type PdfJs = typeof import("pdfjs-dist");

interface PageSize {
  width: number;
  height: number;
}

/** `p-3` on both sides of the scroll container. */
const CONTAINER_PADDING_PX = 24;

/** Cap on backing-store pixels per page canvas, so a zoomed page on a retina
 * screen doesn't allocate hundreds of megabytes. */
const MAX_CANVAS_PIXELS = 16_777_216;

let pdfjsPromise: Promise<PdfJs> | null = null;

/** pdf.js and its worker load with the first PDF opened, once per session. */
function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?worker"),
    ]).then(([pdfjs, { default: PdfWorker }]) => {
      pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
      return pdfjs;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

/**
 * Renders a PDF page by page onto canvases. Pages fit the panel width at 100%
 * zoom, and only pages near the viewport hold a canvas — a long PDF keeps a
 * sized placeholder for the rest.
 */
export function PdfDocument({ doc, zoom }: { doc: DocumentViewerDoc; zoom: number }) {
  const url = useLocalDocumentUrl(doc.path);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [firstPageSize, setFirstPageSize] = useState<PageSize | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () =>
      setContainerWidth(Math.max(0, el.clientWidth - CONTAINER_PADDING_PX));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The panel keys this component by path, so `url` only ever goes from
  // unsigned to signed — there is no previous document's state to reset.
  useEffect(() => {
    if (!url) return;

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const data = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({ data });
        const loaded = await loadingTask.promise;
        const firstPage = await loaded.getPage(1);
        if (cancelled) return;
        const viewport = firstPage.getViewport({ scale: 1 });
        setPdf(loaded);
        setFirstPageSize({ width: viewport.width, height: viewport.height });
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error(`[document-viewer] failed to render pdf ${doc.path}`, err);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [url, doc.path]);

  const scale =
    firstPageSize && containerWidth > 0
      ? (containerWidth / firstPageSize.width) * zoom
      : 0;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-primary-100 dark:bg-primary-900">
      <div ref={scrollRef} className="relative flex-1 min-h-0 overflow-auto p-3">
        {status === "ready" && pdf && firstPageSize && scale > 0 && (
          // `w-max min-w-full` keeps pages centered when they fit and
          // scrollable from their left edge when zoom makes them wider.
          <div className="w-max min-w-full flex flex-col items-center gap-3">
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                pdf={pdf}
                pageNumber={i + 1}
                scale={scale}
                estimatedSize={firstPageSize}
                scrollRoot={scrollRef}
              />
            ))}
          </div>
        )}
        {status === "loading" && (
          <Text as="div" size="xs" tone="faint" className="absolute inset-0 flex items-center justify-center pointer-events-none">
            Loading document…
          </Text>
        )}
        {status === "error" && (
          <div className="absolute inset-0">
            <DocumentFallback doc={doc} />
          </div>
        )}
      </div>
    </div>
  );
}

function PdfPage({
  pdf,
  pageNumber,
  scale,
  estimatedSize,
  scrollRoot,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** First page's size — stands in until this page has loaded its own. */
  estimatedSize: PageSize;
  scrollRoot: RefObject<HTMLDivElement | null>;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [size, setSize] = useState<PageSize | null>(null);

  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsNearViewport(entry.isIntersecting),
      { root: scrollRoot.current, rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl) return;
    if (!isNearViewport) {
      pageEl.replaceChildren();
      return;
    }

    let cancelled = false;
    let task: RenderTask | null = null;

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        setSize((prev) =>
          prev && prev.width === base.width && prev.height === base.height
            ? prev
            : { width: base.width, height: base.height },
        );

        const viewport = page.getViewport({ scale });
        const outputScale = Math.min(
          window.devicePixelRatio || 1,
          Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
        );
        // A fresh canvas per render: pdf.js refuses two render() calls on one
        // canvas, and swapping on completion keeps the old page up while a
        // zoom re-renders.
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        task = page.render({
          canvas,
          viewport,
          transform:
            outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        });
        await task.promise;
        if (!cancelled) pageEl.replaceChildren(canvas);
      } catch (err) {
        if (cancelled || (err as Error)?.name === "RenderingCancelledException") return;
        console.error(`[document-viewer] failed to render pdf page ${pageNumber}`, err);
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, scale, isNearViewport]);

  const { width, height } = size ?? estimatedSize;
  return (
    <div
      ref={pageRef}
      aria-label={`Page ${pageNumber}`}
      className="shrink-0 overflow-hidden rounded-sm bg-white shadow-sm"
      style={{ width: width * scale, height: height * scale }}
    />
  );
}
