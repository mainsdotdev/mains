import {
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "@/hooks/use-click-outside";
import { isAppReady } from "@/lib/app-ready";
import { Button } from "./button";
import { focusNextFrom } from "./focus-navigation";
import Text, { Caption } from "./text";
import { SelectOption as SelectOptionIcon } from "./icons";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /**
   * What the closed trigger shows instead of `label`, for a choice that has to
   * restate its context once the list it was picked from is gone.
   */
  selectedLabel?: string;
  icon?: ReactNode;
  /**
   * Trigger-only glyph, falling back to `icon`. Set it alone when the glyph
   * says what *kind* of thing is selected: repeated down a list where every row
   * is that kind, it marks nothing and is pure noise.
   */
  selectedIcon?: ReactNode;
  description?: string;
}

/**
 * How much room the control takes. `sm` carries the exact metrics of `Input` /
 * `Textarea`, so a select dropped into a compact form lines up with the fields
 * around it instead of standing a row taller than all of them.
 */
export type SelectSize = "sm" | "md";

const TRIGGER_SIZE: Record<SelectSize, string> = {
  md: "min-w-52 px-2.5 py-2 text-sm",
  sm: "px-3 py-2 text-xs",
};

const OPTION_SIZE: Record<SelectSize, string> = {
  md: "text-s",
  sm: "text-xs",
};

interface SelectBaseProps<T extends string = string> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  title?: string;
  /** Inert trigger — for a control an in-flight action has taken over. */
  disabled?: boolean;
  size?: SelectSize;
}

export type SelectProps<T extends string = string> = SelectBaseProps<T> &
  (
    | { "aria-label": string; "aria-labelledby"?: string }
    | { "aria-label"?: undefined; "aria-labelledby": string }
  );

export default function Select<T extends string = string>({
  id,
  value,
  options,
  onChange,
  placeholder = "Select an option",
  title,
  disabled,
  size = "md",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SelectProps<T>) {
  const generatedId = useId();
  const triggerId = id ?? `${generatedId}-trigger`;
  const listboxId = `${generatedId}-listbox`;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [animateIn, setAnimateIn] = useState(false);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocusIndex = useRef(-1);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  // Reset enter animation on each open. Before the app-ready latch animations
  // are globally disabled, so render the final state immediately.
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    setAnimateIn(isOpen && !isAppReady());
  }

  // A control that goes disabled mid-interaction closes its list: the portaled
  // options outlive the trigger, and would stay clickable above an inert one.
  if (disabled && isOpen) setIsOpen(false);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption =
    selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const updateDropdownPosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPosition({ top: rect.bottom, left: rect.left, width: rect.width });
  };

  const openMenu = (preferredIndex: number) => {
    const nextIndex =
      options.length === 0
        ? -1
        : Math.min(options.length - 1, Math.max(0, preferredIndex));
    initialFocusIndex.current = nextIndex;
    setActiveIndex(nextIndex);
    setIsOpen(true);
  };

  const closeMenu = (restoreTriggerFocus: boolean) => {
    setIsOpen(false);
    if (restoreTriggerFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const focusOption = (index: number) => {
    if (options.length === 0) return;
    const nextIndex = (index + options.length) % options.length;
    setActiveIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus({ preventScroll: true });
    optionRefs.current[nextIndex]?.scrollIntoView({ block: "nearest" });
  };

  const selectOption = (option: SelectOption<T>) => {
    onChange(option.value);
    closeMenu(true);
  };

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        openMenu(selectedIndex >= 0 ? selectedIndex : 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        openMenu(selectedIndex >= 0 ? selectedIndex : options.length - 1);
        break;
      case "Home":
        event.preventDefault();
        openMenu(0);
        break;
      case "End":
        event.preventDefault();
        openMenu(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (isOpen) closeMenu(true);
        else openMenu(selectedIndex >= 0 ? selectedIndex : 0);
        break;
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          closeMenu(true);
        }
        break;
    }
  };

  const handleListboxKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        focusOption(options.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        break;
      case "Tab":
        // Continue from the trigger rather than from a portaled option, which
        // would otherwise disappear before the browser resolves its next stop.
        event.preventDefault();
        setIsOpen(false);
        requestAnimationFrame(() =>
          focusNextFrom(triggerRef.current, event.shiftKey),
        );
        break;
    }
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
    const index = initialFocusIndex.current;
    if (index >= 0) {
      optionRefs.current[index]?.focus({ preventScroll: true });
      optionRefs.current[index]?.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let frameId = 0;
    const schedulePositionUpdate = () => {
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        updateDropdownPosition();
      });
    };

    document.addEventListener("scroll", schedulePositionUpdate, true);
    window.addEventListener("resize", schedulePositionUpdate);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      document.removeEventListener("scroll", schedulePositionUpdate, true);
      window.removeEventListener("resize", schedulePositionUpdate);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setAnimateIn(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [isOpen]);

  useClickOutside(
    containerRef,
    () => {
      if (isOpen) setIsOpen(false);
    },
    dropdownRef,
  );

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        id={triggerId}
        type="button"
        variant="bare"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => {
          if (isOpen) closeMenu(false);
          else openMenu(selectedIndex >= 0 ? selectedIndex : 0);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={`
          w-full ${TRIGGER_SIZE[size]}
          glass-button
          text-primary-900 dark:text-primary
          cursor-pointer
          disabled:cursor-not-allowed disabled:opacity-60
          flex items-center justify-between
          transition-[color,background-color,border-radius,box-shadow]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
          ${isOpen ? "rounded-t-xl shadow-lg" : "rounded-xl"}
        `}
      >
        <div className="flex min-w-0 items-center gap-2">
          {selectedOption?.selectedIcon ?? selectedOption?.icon}
          <Text
            as="span"
            size="inherit"
            tone={selectedOption ? "inherit" : "subtle"}
            className="truncate"
          >
            {selectedOption?.selectedLabel || selectedOption?.label || placeholder}
          </Text>
        </div>
        <Caption
          tone="default"
          className="absolute right-8 top-1/2 -translate-y-1/2"
        >
          {title}
        </Caption>
        <SelectOptionIcon
          aria-hidden="true"
          className={`size-3 shrink-0 text-primary-900 transition-transform duration-200 dark:text-primary-100`}
        />
      </Button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={triggerId}
            onKeyDown={handleListboxKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            className={`fixed z-(--z-modal-critical)
              overflow-hidden rounded-b-xl border border-t-0 border-primary-950/10 shadow-lg dark:border-primary/10
              ${animateIn ? "animate-dropdown-in" : "dropdown-prewarm"}
              origin-top
              bg-linear-to-b from-primary to-primary-50 dark:from-primary-900 dark:to-primary-950`}
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: dropdownPosition.width,
            }}
          >
            <div className="max-h-60 overflow-auto noscrollbar">
              {options.map((option, index) => {
                const isSelected = value === option.value;
                const isActive = activeIndex === index;
                return (
                  <Button
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    variant="bare"
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    key={option.value}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                    className={`
                      flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left ${OPTION_SIZE[size]}
                      text-primary-900 transition-colors focus:outline-none dark:text-primary
                      hover:bg-primary-950/5 focus:bg-primary-950/5 dark:hover:bg-primary/5 dark:focus:bg-primary/5
                      ${isSelected || isActive ? "bg-primary-950/5 dark:bg-primary/10" : ""}
                    `}
                  >
                    {option.icon}
                    <div className="flex min-w-0 flex-col">
                      <span className="my-0.5 truncate">{option.label}</span>
                      {option.description && (
                        <Text
                          as="span"
                          size="xxs"
                          tone="subtle"
                          weight="normal"
                          className="truncate tracking-tight"
                        >
                          {option.description}
                        </Text>
                      )}
                    </div>
                  </Button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
