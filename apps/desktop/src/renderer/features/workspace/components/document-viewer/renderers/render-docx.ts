// DOCX renderer — wraps `docx-preview`. Lazy-imported so the library only loads
// when a Word document is opened. Renders into the provided container (a div
// inside the viewer's shadow root); docx-preview injects its own scoped styles.

export interface DocxRenderController {
  setZoom: (zoom: number) => void;
  destroy: () => void;
}

export async function renderDocx(
  buf: ArrayBuffer,
  container: HTMLElement,
  size: { viewport: HTMLElement; zoom: number },
): Promise<DocxRenderController> {
  const { renderAsync } = await import("docx-preview");
  await renderAsync(buf, container, undefined, {
    inWrapper: true,
    useBase64URL: true,
  });

  // Keep the document's paper size and column layout. A fixed-width stage
  // prevents docx-preview's centered pages from overflowing to the left.
  container.classList.add("docx-render-root");
  const style = document.createElement("style");
  style.textContent = `
.docx-render-root { margin-inline: auto; }
.docx-render-root > .docx-wrapper { padding: 0; background: transparent; }
.docx-render-root > .docx-wrapper > section.docx:last-child { margin-bottom: 0; }
`;
  container.prepend(style);

  let zoom = size.zoom;
  let destroyed = false;
  const fit = () => {
    if (destroyed || size.viewport.clientWidth <= 0) return;
    const pages = Array.from(container.querySelectorAll<HTMLElement>("section.docx"));
    const pageWidth = Math.max(0, ...pages.map((page) => page.offsetWidth));
    if (pageWidth <= 0) return;
    container.style.width = `${pageWidth}px`;
    // CSS zoom scales layout as well as painting, so both scroll axes and the
    // height of a multi-page document follow the fitted size.
    container.style.zoom = String(size.viewport.clientWidth / pageWidth * zoom);
  };
  const observer = new ResizeObserver(fit);
  observer.observe(size.viewport);
  fit();

  return {
    setZoom(value) { zoom = value; fit(); },
    destroy() { destroyed = true; observer.disconnect(); },
  };
}
