import {
  ReactNode,
  useCallback,
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
import { Close, Plus, Search, SelectOption as SelectOptionIcon } from "./icons";
import { CheckboxMark } from "./checkbox";
import { Input } from "./input";

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
export type SelectSize = "sm" | "s" | "md";

const TRIGGER_SIZE: Record<SelectSize, string> = {
  md: "min-w-52 px-2.5 py-2 text-s",
  s: "min-w-40 px-2-5 py-2 text-s",
  sm: "px-3 py-2 text-xs",
};

const OPTION_SIZE: Record<SelectSize, string> = {
  md: "text-s",
  s: "text-s",
  sm: "text-xs",
};

interface SelectBaseProps<T extends string = string> {
  id?: string;
  options: SelectOption<T>[];
  placeholder?: string;
  title?: string;
  /** Inert trigger — for a control an in-flight action has taken over. */
  disabled?: boolean;
  size?: SelectSize;
  onOpenChange?: (open: boolean) => void;
  /** Keep the default anchored spring, or reveal vertically without scaling the options. */
  animationDirection?: "origin" | "up" | "down";
  /** Show each option's full description in a tooltip on hover or focus. */
  showOptionDescriptionTooltip?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  maxSearchLength?: number;
  emptyMessage?: string;
}

export type SelectProps<T extends string = string> = SelectBaseProps<T> &
  (
    | { multiple?: false; value: T; onChange: (value: T) => void }
    | {
        multiple: true;
        value: T[];
        onChange: (value: T[]) => void;
        /** Return a new option value; undefined leaves the query unselected. */
        onCreateOption?: (label: string) => T | undefined;
        maxSelected?: number;
        /** Keep compact forms at one row; values remain visible in the trigger. */
        showSelectedOptions?: boolean;
      }
  ) &
  (
    | { "aria-label": string; "aria-labelledby"?: string }
    | { "aria-label"?: undefined; "aria-labelledby": string }
  );

export default function Select<T extends string = string>(
  props: SelectProps<T>,
) {
  const {
    id,
    options,
    placeholder = "Select an option",
    title,
    disabled,
    size = "md",
    onOpenChange,
    animationDirection = "origin",
    showOptionDescriptionTooltip = false,
    searchable = props.multiple ?? false,
    searchPlaceholder = "Search options",
    maxSearchLength,
    emptyMessage = "No matching options",
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
  } = props;
  const generatedId = useId();
  const triggerId = id ?? `${generatedId}-trigger`;
  const listboxId = `${generatedId}-listbox`;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const [animateIn, setAnimateIn] = useState(false);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocusIndex = useRef(-1);
  const notifiedOpenRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 0,
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

  const selectedValues = props.multiple ? props.value : [props.value];
  const selectedIndex = options.findIndex((option) =>
    selectedValues.includes(option.value),
  );
  const selectedOption =
    selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const selectedOptions: SelectOption<T>[] = selectedValues.map(
    (value) =>
      options.find((option) => option.value === value) ?? {
        value,
        label: value,
      },
  );
  const normalize = (value: string) =>
    value.normalize("NFKC").trim().toLowerCase();
  const filteredOptions =
    searchable && query.trim()
      ? options.filter((option) =>
          normalize(`${option.label} ${option.description ?? ""}`).includes(
            normalize(query),
          ),
        )
      : options;
  const canCreate =
    props.multiple &&
    props.onCreateOption &&
    query.trim() &&
    !options.some((option) => normalize(option.label) === normalize(query));
  const limitReached =
    props.multiple &&
    props.maxSelected !== undefined &&
    props.value.length >= props.maxSelected;
  type MenuEntry = { option: SelectOption<T> } | { create: string };
  const entries: MenuEntry[] = [
    ...filteredOptions.map((option) => ({ option })),
    ...(canCreate ? [{ create: query.trim() }] : []),
  ];
  const entryDisabled = (entry: MenuEntry) =>
    !!limitReached &&
    (!("option" in entry) || !selectedValues.includes(entry.option.value));

  const setOpen = (open: boolean) => {
    if (open === notifiedOpenRef.current) return;
    notifiedOpenRef.current = open;
    setIsOpen(open);
    onOpenChangeRef.current?.(open);
  };

  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const rootFontSize = parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    setDropdownPosition({
      top: rect.bottom,
      left: rect.left,
      width: rect.width,
      // Multiple selection gets a little more room for its taller rows.
      maxHeight: Math.max(
        0,
        Math.min((props.multiple ? 18 : 15) * rootFontSize, window.innerHeight - rect.bottom - 8) -
          (searchable ? 44 : 0),
      ),
    });
  }, [props.multiple, searchable]);

  const openMenu = (preferredIndex: number, focusSearch = searchable) => {
    setQuery("");
    const nextIndex =
      options.length === 0
        ? -1
        : Math.min(options.length - 1, Math.max(0, preferredIndex));
    initialFocusIndex.current = focusSearch ? -1 : nextIndex;
    setActiveIndex(nextIndex);
    setOpen(true);
  };

  const closeMenu = (restoreTriggerFocus: boolean) => {
    setOpen(false);
    if (restoreTriggerFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const focusOption = (index: number) => {
    if (entries.length === 0) return;
    const direction = index < activeIndex ? -1 : 1;
    for (let step = 0; step < entries.length; step++) {
      const nextIndex =
        (((index + direction * step) % entries.length) + entries.length) %
        entries.length;
      if (entryDisabled(entries[nextIndex])) continue;
      setActiveIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus({ preventScroll: true });
      optionRefs.current[nextIndex]?.scrollIntoView({ block: "nearest" });
      return;
    }
  };

  const selectOption = (option: SelectOption<T>) => {
    if (props.multiple) {
      if (props.value.includes(option.value))
        props.onChange(props.value.filter((value) => value !== option.value));
      else if (!limitReached) props.onChange([...props.value, option.value]);
    } else {
      props.onChange(option.value);
      closeMenu(true);
    }
  };

  const createOption = () => {
    if (
      !props.multiple ||
      !props.onCreateOption ||
      !query.trim() ||
      limitReached
    )
      return;
    const value = props.onCreateOption(query.trim());
    if (value === undefined) return;
    if (!props.value.includes(value)) props.onChange([...props.value, value]);
    setQuery("");
    setActiveIndex(-1);
    searchRef.current?.focus();
  };

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        openMenu(selectedIndex >= 0 ? selectedIndex : 0, false);
        break;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        openMenu(
          selectedIndex >= 0 ? selectedIndex : options.length - 1,
          false,
        );
        break;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        openMenu(0, false);
        break;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        openMenu(options.length - 1, false);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        if (isOpen) closeMenu(true);
        else openMenu(selectedIndex >= 0 ? selectedIndex : 0);
        break;
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu(true);
        }
        break;
    }
  };

  const handleListboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target === searchRef.current) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        focusOption(event.key === "ArrowDown" ? 0 : entries.length - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const exact = filteredOptions.find(
          (option) => normalize(option.label) === normalize(query),
        );
        if (exact) selectOption(exact);
        else if (canCreate) createOption();
        else if (filteredOptions[0]) selectOption(filteredOptions[0]);
        return;
      }
      if (event.key !== "Escape" && event.key !== "Tab") return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        focusOption(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        if (searchable && activeIndex === 0) {
          setActiveIndex(-1);
          searchRef.current?.focus();
        } else focusOption(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        focusOption(entries.length - 1);
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
        event.stopPropagation();
        setOpen(false);
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
    if (index < 0 && searchable) searchRef.current?.focus();
    else if (index >= 0) {
      optionRefs.current[index]?.focus({ preventScroll: true });
      optionRefs.current[index]?.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen, searchable, updateDropdownPosition]);

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
    // Centered dialogs move the trigger when their content grows, without a
    // window resize or scroll. Track its layout ancestors as well as the field.
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(schedulePositionUpdate)
      : undefined;
    for (let element: HTMLElement | null = triggerRef.current; element; element = element.parentElement) {
      observer?.observe(element);
    }

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      observer?.disconnect();
      document.removeEventListener("scroll", schedulePositionUpdate, true);
      window.removeEventListener("resize", schedulePositionUpdate);
    };
  }, [isOpen, updateDropdownPosition]);

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
      if (isOpen) setOpen(false);
    },
    dropdownRef,
  );

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(
    () => () => {
      if (notifiedOpenRef.current) onOpenChangeRef.current?.(false);
    },
    [],
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
          glass-input
          pl-4.5 pr-2.5
          text-primary-900 dark:text-primary
          cursor-pointer
          disabled:cursor-not-allowed disabled:opacity-60
          flex items-center justify-between
          transition-[color,background-color,border-radius,box-shadow]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
          ${isOpen ? "rounded-t-xl shadow-lg" : "rounded-xl"}
        `}
      >
        <div className="flex min-w-0 items-center gap-2">
          {selectedOption?.selectedIcon ?? selectedOption?.icon}
          <Text
            as="span"
            size="inherit"
            tone={
              (props.multiple ? selectedOptions.length > 0 : !!selectedOption)
                ? "inherit"
                : "subtle"
            }
            className="truncate"
          >
            {props.multiple
              ? selectedOptions.length
                ? selectedOptions
                    .map((option) => option.selectedLabel ?? option.label)
                    .join(", ")
                : placeholder
              : selectedOption?.selectedLabel ||
                selectedOption?.label ||
                placeholder}
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
            data-dropdown-portal="true"
            data-animation-direction={animationDirection}
            onKeyDown={handleListboxKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            className={`fixed z-(--z-modal-critical)
              overflow-hidden rounded-b-xl border border-t-0 border-primary-950/10 shadow-lg dark:border-primary/10
              ${animationDirection !== "origin"
                ? `dropdown-vertical ${animateIn ? "animate-dropdown-vertical-in" : "dropdown-prewarm-vertical"}`
                : animateIn ? "animate-dropdown-in" : "dropdown-prewarm"}
              origin-top
               bg-primary-50  dark:bg-primary-950`}
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: dropdownPosition.width,
            }}
          >
            {searchable && (
              <div className="relative border-b border-primary-950/5 p-1.5 dark:border-primary/10">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-primary-500"
                />
                <Input
                  ref={searchRef}
                  type="search"
                  aria-label={searchPlaceholder}
                  placeholder={searchPlaceholder}
                  maxLength={maxSearchLength}
                  variant="bare"
                  value={query}
                  className="h-8 w-full rounded-lg py-1 pl-8 pr-2 text-xs"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(-1);
                  }}
                />
              </div>
            )}
            <div
              id={listboxId}
              role="listbox"
              aria-labelledby={triggerId}
              aria-multiselectable={props.multiple || undefined}
              className="overflow-auto noscrollbar space-y-0.5 p-1"
              style={{ maxHeight: dropdownPosition.maxHeight }}
            >
              {entries.map((entry, index) => {
                const option = "option" in entry ? entry.option : undefined;
                const isSelected =
                  !!option && selectedValues.includes(option.value);
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
                    key={option ? `option:${option.value}` : "create"}
                    onFocus={() => setActiveIndex(index)}
                    disabled={entryDisabled(entry)}
                    onClick={() =>
                      option ? selectOption(option) : createOption()
                    }
                    tooltip={
                      showOptionDescriptionTooltip
                        ? option?.description
                        : undefined
                    }
                    className={`
                      flex w-full cursor-pointer items-center px-3 text-left ${OPTION_SIZE[size]}
                      ${props.multiple ? "gap-2 rounded-lg py-1.5" : "gap-1 rounded-[10px] py-1"}
                      text-primary-900 transition-colors focus:outline-none dark:text-primary
                      hover:bg-primary-950/5 focus:bg-primary-950/5 dark:hover:bg-primary/5 dark:focus:bg-primary/5
                      ${isSelected || !props.multiple && isActive ? "bg-primary-950/5 dark:bg-primary/10" : isActive ? "bg-primary-950/5 dark:bg-primary/5" : ""}
                    `}
                  >
                    {option ? (
                      <>
                        {props.multiple && (
                          <CheckboxMark checked={isSelected} />
                        )}
                        {option.icon}
                      </>
                    ) : (
                      <Plus
                        aria-hidden="true"
                        className="mr-1 size-4 shrink-0"
                      />
                    )}
                    <div className="flex min-w-0 flex-col">
                      <span className=" truncate">
                        {option?.label ??
                          ("create" in entry ? `Create “${entry.create}”` : "")}
                      </span>
                      {option?.description && (
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
              {!entries.length && (
                <Text as="div" size="xs" tone="subtle" className="px-3 py-2">
                  {emptyMessage}
                </Text>
              )}
            </div>
          </div>,
          document.body,
        )}
      {props.multiple && props.showSelectedOptions !== false && selectedOptions.length > 0 && (
        <div
          className="mt-2 flex flex-wrap gap-1.5"
          aria-label="Selected options"
        >
          {selectedOptions.map((option) => (
            <span
              key={option.value}
              className="inline-flex max-w-full items-center gap-1 rounded-lg bg-primary-100 px-2 py-1 text-xs text-primary-700 dark:bg-primary-800 dark:text-primary-300"
            >
              {option.selectedIcon ?? option.icon}
              <span className="truncate">{option.label}</span>
              <Button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${option.label}`}
                className="shrink-0 rounded p-0.5"
                onClick={() => {
                  if (props.multiple)
                    props.onChange(
                      props.value.filter((value) => value !== option.value),
                    );
                  triggerRef.current?.focus();
                }}
              >
                <Close aria-hidden="true" className="size-3" />
              </Button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
