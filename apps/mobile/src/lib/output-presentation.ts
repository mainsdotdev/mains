/** HTML files and interactive artifacts remain desktop-only until mobile support is ready. */
export function isDesktopOnlyOutput(output: { name: string; mimeType?: string; kind?: string }): boolean {
  return output.kind === "visualization" || /\.(?:html?|xhtml)$/i.test(output.name) ||
    /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(output.mimeType ?? "");
}
