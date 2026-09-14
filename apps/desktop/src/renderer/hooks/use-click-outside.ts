import { useEffect } from "react";

/**
 * Fires `callback` on mousedown outside `ref` (and `extraRef`, if provided).
 *
 * The optional `extraRef` exists for triggers/portaled dropdowns where the
 * trigger and the menu live in separate DOM trees — a click on either should
 * NOT be treated as "outside". Both refs are checked; callback fires only
 * when neither contains the event target AND at least one ref is mounted
 * (preserves original behavior of skipping while refs are null).
 */
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  callback: () => void,
  extraRef?: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const hasAnyRef = !!ref.current || !!extraRef?.current;
      if (!hasAnyRef) return;
      const inside =
        (ref.current?.contains(target) ?? false) ||
        (extraRef?.current?.contains(target) ?? false);
      if (!inside) callback();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [ref, extraRef, callback]);
}
