/** The child window has only a chat surface and its body-level popovers. */
export function isBrowserChatInteractiveTarget(
  element: Element | null,
  doc: Document,
): boolean {
  if (!element) return false;
  if (element.closest("[data-browser-chat-surface]")) return true;
  const root = doc.getElementById("root");
  return element !== doc.body && element !== doc.documentElement &&
    element !== root && !root?.contains(element);
}
