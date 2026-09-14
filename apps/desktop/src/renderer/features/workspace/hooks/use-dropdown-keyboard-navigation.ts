import { useEffect, useState } from "react";

interface UseDropdownKeyboardNavigationArgs {
  isOpen: boolean;
  itemCount: number;
  disabled?: boolean;
  resetKey?: string;
  onSelectActive: (index: number) => void;
}

function isPlainEnter(event: KeyboardEvent) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isComposing
  );
}

export function useDropdownKeyboardNavigation({
  isOpen,
  itemCount,
  disabled = false,
  resetKey = "",
  onSelectActive,
}: UseDropdownKeyboardNavigationArgs) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [openEpoch, setOpenEpoch] = useState({ isOpen, resetKey });

  const maxIndex = Math.max(itemCount - 1, 0);
  let nextIndex = activeIndex;

  if (openEpoch.isOpen !== isOpen || openEpoch.resetKey !== resetKey) {
    setOpenEpoch({ isOpen, resetKey });
    if (isOpen && (!openEpoch.isOpen || openEpoch.resetKey !== resetKey)) {
      nextIndex = 0;
    }
  }

  nextIndex = Math.min(nextIndex, maxIndex);
  if (nextIndex !== activeIndex) {
    setActiveIndex(nextIndex);
  }

  useEffect(() => {
    if (!isOpen || disabled || itemCount === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setActiveIndex((current) => (current + 1) % itemCount);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setActiveIndex((current) => (current - 1 + itemCount) % itemCount);
        return;
      }

      if (!isPlainEnter(event)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onSelectActive(activeIndex);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeIndex, disabled, isOpen, itemCount, onSelectActive]);

  useEffect(() => {
    if (!isOpen || itemCount === 0) return;

    const frameId = window.requestAnimationFrame(() => {
      document
        .querySelector('[data-dropdown-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeIndex, isOpen, itemCount]);

  return { activeIndex, setActiveIndex };
}
