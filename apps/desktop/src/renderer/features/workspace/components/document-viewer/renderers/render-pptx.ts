// PPTX renderer — wraps `pptx-preview`. Lazy-imported. Pure-JS PPTX rendering is
// best-effort: this throws on failure (or when no slides are produced) so the
// host can fall back to "Open with…". `size` sets the slide canvas; the library
// scales slide content to fit.

export async function renderPptx(
  buf: ArrayBuffer,
  container: HTMLElement,
  size: { width: number; height: number },
): Promise<void> {
  const { init } = await import("pptx-preview");
  const previewer = init(container, {
    width: Math.max(320, Math.round(size.width)),
    height: Math.max(180, Math.round(size.height)),
  });
  await previewer.preview(buf);
}
