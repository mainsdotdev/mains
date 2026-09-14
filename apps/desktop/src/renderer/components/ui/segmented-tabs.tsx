import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

export interface SegmentedTabOption<T extends string> {
  value: T;
  label: ReactNode;
}

export type SegmentedTabsSemantics = "tabs" | "radiogroup";

interface SegmentedTabsBaseProps<T extends string> {
  id?: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentedTabOption<T>>;
  /** Tabs switch panels; radiogroups choose a filter or setting value. */
  semantics?: SegmentedTabsSemantics;
  /** Shared panel controlled by the tabs. Ignored for radiogroups. */
  panelId?: string;
  /**
   * Visual treatment:
   *  - `pill`  (default) — container bg + sliding indicator (Dashboard, Plugins)
   *  - `plain` — no container, just the sliding active highlight (Connections)
   */
  variant?: "pill" | "plain";
  /** When true, all tabs render disabled (used by sections behind a toggle). */
  disabled?: boolean;
  className?: string;
}

type SegmentedTabsAccessibleName =
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-label"?: never; "aria-labelledby": string };

export type SegmentedTabsProps<T extends string> =
  SegmentedTabsBaseProps<T> & SegmentedTabsAccessibleName;

export type SegmentedTabsNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";

export function getSegmentedTabId(groupId: string, value: string): string {
  return `${groupId}-${value}-tab`;
}

export function getNextSegmentedValue<T extends string>(
  values: ReadonlyArray<T>,
  current: T,
  key: SegmentedTabsNavigationKey,
): T | null {
  if (values.length === 0) return null;
  if (key === "Home") return values[0];
  if (key === "End") return values[values.length - 1];

  const currentIndex = Math.max(0, values.indexOf(current));
  const forwards = key === "ArrowRight" || key === "ArrowDown";
  const offset = forwards ? 1 : -1;
  return values[(currentIndex + offset + values.length) % values.length];
}

export function SegmentedTabs<T extends string>({
  id,
  value,
  onChange,
  options,
  semantics = "tabs",
  panelId,
  variant = "pill",
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SegmentedTabsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const isTabList = semantics === "tabs";
  const hasActiveOption = options.some((option) => option.value === value);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();
    const nextValue = getNextSegmentedValue(
      options.map((option) => option.value),
      value,
      event.key,
    );
    if (!nextValue) return;

    tabRefs.current.get(nextValue)?.focus();
    if (nextValue !== value) onChange(nextValue);
  };

  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    const activeTab = tabRefs.current.get(value);
    if (!container || !activeTab) return;
    const containerRect = container.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    setIndicator({
      left: tabRect.left - containerRect.left,
      width: tabRect.width,
    });
  }, [value]);

  useLayoutEffect(() => {
    updateIndicator();
    const ro = new ResizeObserver(() => updateIndicator());
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", updateIndicator);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [updateIndicator]);

  const containerClass =
    variant === "pill"
      ? "relative flex rounded-full glass-outline p-0.5 bg-primary-50/20 dark:bg-primary/2"
      : "relative flex gap-1";

  const tabClass = (isActive: boolean) => {
    if (variant === "pill") {
      return cn(
        "relative z-(--z-base) flex-1 text-center px-3 py-1 text-xs font-medium rounded-[10px] whitespace-nowrap transition-colors duration-300",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 focus-visible:ring-offset-0",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        isActive
          ? "text-primary-900 dark:text-primary-100"
          : "text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300",
      );
    }
    // plain — the sliding indicator owns the active background.
    return cn(
      "relative z-(--z-base) px-2.5 py-1 text-s rounded-xl whitespace-nowrap transition-colors duration-300",
      "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 focus-visible:ring-offset-0",
      disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      isActive
        ? "text-primary-900 dark:text-primary-100"
        : "text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 hover:bg-primary-100/50 dark:hover:bg-primary-800/30",
    );
  };

  return (
    <div
      id={id}
      ref={containerRef}
      role={isTabList ? "tablist" : "radiogroup"}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-orientation="horizontal"
      className={cn(containerClass, className)}
    >
      <div
        aria-hidden
        className={cn(
          "absolute transition-all duration-300 ease-in-out",
          variant === "pill"
            ? "top-0.75 glass-outline bg-primary dark:bg-primary/10 rounded-full"
            : "inset-y-0 bg-primary-200/80 dark:bg-primary-800/60 glass-button rounded-xl",
        )}
        style={{
          left: indicator.left,
          width: indicator.width,
          ...(variant === "pill" ? { height: "calc(100% - 5.5px)" } : {}),
        }}
      />
      {options.map((opt, index) => {
        const isActive = value === opt.value;
        const isTabStop = isActive || (!hasActiveOption && index === 0);
        return (
          <Button
            key={opt.value}
            ref={(el) => {
              if (el) tabRefs.current.set(opt.value, el);
              else tabRefs.current.delete(opt.value);
            }}
            type="button"
            onClick={() => !disabled && onChange(opt.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            id={id ? getSegmentedTabId(id, opt.value) : undefined}
            role={isTabList ? "tab" : "radio"}
            aria-selected={isTabList ? isActive : undefined}
            aria-checked={isTabList ? undefined : isActive}
            aria-controls={isTabList ? panelId : undefined}
            tabIndex={isTabStop ? 0 : -1}
            data-active={isActive ? "true" : undefined}
            className={tabClass(isActive)}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
