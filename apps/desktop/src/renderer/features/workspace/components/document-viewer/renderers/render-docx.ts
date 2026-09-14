// DOCX renderer — wraps `docx-preview`. Lazy-imported so the library only loads
// when a Word document is opened. Renders into the provided container (a div
// inside the viewer's shadow root); docx-preview injects its own scoped styles.

export async function renderDocx(
  buf: ArrayBuffer,
  container: HTMLElement,
): Promise<void> {
  const { renderAsync } = await import("docx-preview");
  await renderAsync(buf, container, undefined, {
    inWrapper: true,
    useBase64URL: true,
  });
}
