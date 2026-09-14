const PAGE_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Continue page tab order from a trigger after its portaled popup unmounts. */
export function focusNextFrom(
  anchor: HTMLElement | null,
  backwards: boolean,
): void {
  if (!anchor) return;
  const focusable = Array.from(
    document.querySelectorAll<HTMLElement>(PAGE_FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
  const anchorIndex = focusable.indexOf(anchor);
  if (anchorIndex < 0) {
    anchor.focus();
    return;
  }
  const nextIndex = backwards ? anchorIndex - 1 : anchorIndex + 1;
  const fallbackIndex = backwards ? focusable.length - 1 : 0;
  const target = focusable[nextIndex] ?? focusable[fallbackIndex];
  target?.focus();
}
