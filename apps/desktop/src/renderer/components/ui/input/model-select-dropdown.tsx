import {
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../button";
import Text from "../text";
import DropdownWrapper from "../dropdown-wrapper";
import { useClickOutside } from "@/hooks/use-click-outside";
import {
  formatModelDisplayName,
  getModelIcon,
  selectableModelNames,
} from "@/lib/model-icons";
import { formatEffortLevel } from "@/lib/format";
import { ArrowUp, Brain, Check } from "../icons";
import { ULTRACODE_GRADIENT_TEXT } from "./ultracode-styles";

type EffortLevel = "minimal" | "low" | "medium" | "high" | "max" | "xhigh";

// ─────────────────────────────────────────────────────────────
// Submenu travel ("safe triangle")
//
// The effort submenu is bottom-aligned to the model menu and taller than it,
// so reaching an entry near its top means moving diagonally up-and-right —
// straight across the model rows above the anchor. Plain `mouseenter` rebinds
// the submenu to every row crossed, and the effort click then lands on the
// wrong model (pick Sonnet's effort, end up on Fable).
//
// Fix: while the pointer is inside the corridor between where the submenu
// opened and the submenu's near edge, treat a row it crosses as travel rather
// than intent — the row only takes over if the pointer settles on it.
// ─────────────────────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** How long the pointer must rest on a crossed row before it takes over. */
const SUBMENU_TRAVEL_DWELL_MS = 90;

/** Vertical slack on the corridor's base, in px. */
const SAFE_TRIANGLE_PADDING = 12;

function triangleSide(p: Point, a: Point, b: Point): number {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

/**
 * Is `pointer` inside the triangle spanned by `anchor` (where the pointer was
 * when the submenu opened) and the submenu's near edge?
 *
 * Inside means "on its way to the submenu"; outside means the pointer is
 * genuinely browsing the model list. Exported for tests — no DOM access.
 */
export function isPointerHeadingToSubmenu(
  pointer: Point,
  anchor: Point,
  submenu: Edges,
  padding: number = SAFE_TRIANGLE_PADDING,
): boolean {
  // The submenu flips to the left of the model menu when it doesn't fit on the
  // right; the near edge is whichever side faces the anchor.
  const edgeX = submenu.left >= anchor.x ? submenu.left : submenu.right;
  const top: Point = { x: edgeX, y: submenu.top - padding };
  const bottom: Point = { x: edgeX, y: submenu.bottom + padding };

  const d1 = triangleSide(pointer, anchor, top);
  const d2 = triangleSide(pointer, top, bottom);
  const d3 = triangleSide(pointer, bottom, anchor);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

interface ModelSelectDropdownProps {
  model: string;
  models: string[];
  modelEffortLevelsByModel: Record<string, EffortLevel[] | undefined>;
  onModelChange: (model: string) => void;
  thinkingMode: boolean;
  effortLevel: string;
  onEffortLevelChange: (level: string) => void;
  onThinkingModeToggle: () => void;
  isOpen: boolean;
  onToggle: () => void;
  onClose?: () => void;
  dropdownRef: RefObject<HTMLDivElement | null>;
  openUpward?: boolean;
  isLoading?: boolean;
  variant?: "claude" | "copilot" | "codex" | "cursor";
}

export function ModelSelectDropdown({
  model,
  models,
  modelEffortLevelsByModel,
  onModelChange,
  thinkingMode,
  effortLevel,
  onEffortLevelChange,
  onThinkingModeToggle,
  isOpen,
  onToggle,
  onClose,
  dropdownRef,
  openUpward = false,
  isLoading = false,
  variant,
}: ModelSelectDropdownProps) {
  const modelList = selectableModelNames(models, variant);
  const noModels = !isLoading && modelList.length === 0;
  const displayModel = formatModelDisplayName(model, variant);
  const selectedModelEffortLevels =
    modelEffortLevelsByModel[model] ?? [];
  const selectedModelUsesThinkingToggle =
    variant === "claude" && selectedModelEffortLevels.length === 0;
  const mainMenuRef = useRef<HTMLDivElement>(null);
  const effortMenuRef = useRef<HTMLDivElement>(null);
  /** The submenu's "<model> · Effort" caption — measured to offset the panel. */
  const effortMenuHeaderRef = useRef<HTMLDivElement>(null);
  const effortCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest pointer position over the model list, for the safe-triangle test. */
  const pointerRef = useRef<Point | null>(null);
  /** Where the pointer was when the open submenu was bound — the corridor apex. */
  const travelAnchorRef = useRef<Point | null>(null);
  /** A row crossed mid-travel, waiting to see whether the pointer settles. */
  const pendingRowRef = useRef<{
    model: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);
  const [effortMenuPosition, setEffortMenuPosition] = useState<{
    /** Top of the anchor row — the line the first selectable entry lines up with. */
    anchorTop: number;
    /**
     * Applied top: `anchorTop` lifted by the caption's height and clamped into
     * the viewport, both resolved from measurements once the submenu renders.
     */
    top: number;
    left: number;
  } | null>(null);
  /**
   * Whether choosing this model opens the effort / thinking submenu.
   *
   * This decides what a click on the model row means. With a submenu the click
   * is only the first half of the interaction — the menu stays open so the
   * follow-up choice can be made, and that branch closes it. Without one the
   * click is the whole interaction, so leaving the menu open just strands it.
   *
   * Claude models advertising no effort levels still get an On/Off thinking
   * toggle, so for that variant there is always a submenu.
   */
  const modelHasEffortMenu = (candidate: string) =>
    (modelEffortLevelsByModel[candidate] ?? []).length > 0 || variant === "claude";

  const hoveredModelEffortLevels = hoveredModel
    ? (modelEffortLevelsByModel[hoveredModel] ?? [])
    : [];
  const hoveredModelDisplayName = hoveredModel
    ? formatModelDisplayName(hoveredModel, variant)
    : "";
  const hoveredModelHasEffortMenu =
    !!hoveredModel && modelHasEffortMenu(hoveredModel);
  const hoveredModelSupportsUltracode =
    variant === "claude" &&
    hoveredModelEffortLevels.includes("xhigh");
  const hoveredModelHasSelectedUltracode =
    hoveredModel === model &&
    thinkingMode &&
    effortLevel === "ultracode";
  const selectedEffortLabel =
    thinkingMode && effortLevel
      ? formatEffortLevel(effortLevel)
      : selectedModelUsesThinkingToggle && thinkingMode
        ? "On"
        : "";

  useClickOutside(
    dropdownRef,
    () => {
      if (isOpen && onClose) {
        setHoveredModel(null);
        onClose();
      }
    },
    effortMenuRef,
  );

  const clearEffortCloseTimer = () => {
    if (!effortCloseTimerRef.current) return;
    clearTimeout(effortCloseTimerRef.current);
    effortCloseTimerRef.current = null;
  };

  const clearPendingRow = () => {
    if (!pendingRowRef.current) return;
    clearTimeout(pendingRowRef.current.timer);
    pendingRowRef.current = null;
  };

  const closeEffortMenu = () => {
    clearEffortCloseTimer();
    clearPendingRow();
    travelAnchorRef.current = null;
    setHoveredModel(null);
  };

  const scheduleEffortMenuClose = () => {
    clearEffortCloseTimer();
    effortCloseTimerRef.current = setTimeout(() => {
      clearPendingRow();
      travelAnchorRef.current = null;
      setHoveredModel(null);
      effortCloseTimerRef.current = null;
    }, 140);
  };

  const openEffortMenu = (hovered: string, rowTop?: number) => {
    clearEffortCloseTimer();
    clearPendingRow();
    travelAnchorRef.current = pointerRef.current;
    if (!modelHasEffortMenu(hovered)) {
      setHoveredModel(null);
      return;
    }

    const menuRect = mainMenuRef.current?.getBoundingClientRect();
    if (!menuRect) return;

    const panelWidth = 144;
    const gap = 6;
    const fitsOnRight =
      menuRect.right + gap + panelWidth <= window.innerWidth - 8;

    setHoveredModel(hovered);
    setEffortMenuPosition({
      // Anchored to the row, not the menu. Bottom-aligning the submenu to the
      // whole menu put a short submenu (Cursor's low/medium/high) at the very
      // bottom while its row sat at the top, so reaching it meant a long
      // diagonal down across every row in between. Row-aligned travel is short
      // and roughly horizontal.
      anchorTop: rowTop ?? menuRect.top,
      top: Math.max(8, rowTop ?? menuRect.top),
      left: fitsOnRight
        ? menuRect.right + gap
        : Math.max(8, menuRect.left - panelWidth - gap),
    });
  };

  // Both offsets depend on rendered geometry — the panel's height varies with
  // the model's effort levels, and the caption's height with the type scale —
  // so they can only be applied once the submenu exists. Layout effect: runs
  // before paint, so the correction is never visible.
  useLayoutEffect(() => {
    const element = effortMenuRef.current;
    if (!element || !effortMenuPosition) return;
    // Lift the panel by its caption so the row lines up with the first
    // *selectable* entry; landing on the caption means moving right from the
    // model row hits dead space.
    const captionHeight = effortMenuHeaderRef.current?.offsetHeight ?? 0;
    // offsetHeight, not getBoundingClientRect: the open animation scales the
    // panel from 0.85, and a transformed rect would measure ~15% short on the
    // first frame and clamp the panel off the bottom of the screen.
    const maxTop = Math.max(8, window.innerHeight - 8 - element.offsetHeight);
    const desired = effortMenuPosition.anchorTop - captionHeight;
    const clamped = Math.min(Math.max(8, desired), maxTop);
    if (Math.abs(clamped - effortMenuPosition.top) > 0.5) {
      setEffortMenuPosition({ ...effortMenuPosition, top: clamped });
    }
  }, [effortMenuPosition, hoveredModel]);

  /** True while the pointer is travelling from the anchor row to the submenu. */
  const isTravellingToSubmenu = () => {
    const pointer = pointerRef.current;
    const anchor = travelAnchorRef.current;
    const submenu = effortMenuRef.current?.getBoundingClientRect();
    if (!pointer || !anchor || !submenu) return false;
    return isPointerHeadingToSubmenu(pointer, anchor, submenu);
  };

  /**
   * Hover entry point for a model row. While a submenu is open, a row only
   * takes it over once the pointer settles there — either because the pointer
   * is travelling to the submenu, or because the row would tear the submenu
   * down (a model with no effort levels, like Cursor's Auto or Composer). Both
   * cases used to fire on the way past and hijack the gesture.
   */
  const requestEffortMenu = (candidate: string, rowTop: number, pointer?: Point) => {
    if (pointer) pointerRef.current = pointer;
    // Crossed rows leave their own close timers behind; keep the submenu alive
    // for the whole trip.
    clearEffortCloseTimer();

    if (candidate === hoveredModel) {
      clearPendingRow();
      return;
    }

    const wouldCloseSubmenu = !modelHasEffortMenu(candidate);
    const isTravel = isTravellingToSubmenu() || wouldCloseSubmenu;
    if (!hoveredModel || !isTravel) {
      openEffortMenu(candidate, rowTop);
      return;
    }
    if (pendingRowRef.current?.model === candidate) return;

    clearPendingRow();
    pendingRowRef.current = {
      model: candidate,
      timer: setTimeout(() => {
        pendingRowRef.current = null;
        openEffortMenu(candidate, rowTop);
      }, SUBMENU_TRAVEL_DWELL_MS),
    };
  };

  const selectModel = (candidate: string) => {
    onModelChange(candidate);
    // Models with a submenu keep the menu open so the effort/thinking choice can
    // follow; that branch closes it on selection.
    if (modelHasEffortMenu(candidate)) return;
    closeEffortMenu();
    onClose?.();
  };

  const selectEffortForHoveredModel = (level: string) => {
    if (hoveredModel && hoveredModel !== model) {
      onModelChange(hoveredModel);
    }
    onEffortLevelChange(level);
    closeEffortMenu();
    onClose?.();
  };

  const selectThinkingForHoveredModel = (enabled: boolean) => {
    if (hoveredModel && hoveredModel !== model) {
      onModelChange(hoveredModel);
    }
    if (thinkingMode !== enabled) {
      onThinkingModeToggle();
    }
    closeEffortMenu();
    onClose?.();
  };

  useEffect(
    () => () => {
      if (effortCloseTimerRef.current) {
        clearTimeout(effortCloseTimerRef.current);
      }
      if (pendingRowRef.current) {
        clearTimeout(pendingRowRef.current.timer);
      }
    },
    [],
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex cursor-pointer items-center hover:bg-primary-200/30 animate-blur-reveal dark:hover:bg-primary-800 transition-colors rounded-2xl">
        <Button
          tooltip={noModels ? "No models available" : "Select model"}
          tooltipPosition="top"
          type="button"
          onClick={
            noModels
              ? undefined
              : () => {
                  if (isOpen) closeEffortMenu();
                  onToggle();
                }
          }
          className={`text-sm  px-2 py-1.5 flex items-center gap-1.5 ${
            noModels
              ? "text-primary-600 dark:text-primary-400 cursor-not-allowed"
              : "cursor-pointer text-primary-950 dark:text-primary"
          }`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          disabled={noModels || (isLoading && !displayModel)}
        >
          {isLoading && !displayModel ? (
            <span className="inline-flex items-center gap-1.5">
              <Text as="span" tone="inherit" className="shine-text">
                Loading models...
              </Text>
            </span>
          ) : noModels ? (
            <span>No models found</span>
          ) : (
            <>
              {getModelIcon(displayModel, variant)}
              <span className="min-w-0 truncate">{displayModel}</span>
              {selectedEffortLabel && (
                <span
                  className={`shrink-0 capitalize ${
                    effortLevel === "ultracode"
                      ? `font-medium ${ULTRACODE_GRADIENT_TEXT}`
                      : "font-normal text-primary-600 dark:text-primary-400"
                  }`}
                >
                  {selectedEffortLabel}
                </span>
              )}
              <ArrowUp className={`size-3.5 shrink-0 rotate-180 ${effortLevel === "ultracode" ? "text-indigo-500 dark:text-indigo-400" : ""}`} />
            </>
          )}
        </Button>
      </div>

      <DropdownWrapper
        isOpen={isOpen}
        aria-label="Model selection"
        openUpward={openUpward}
        minWidth="min-w-48"
        dropdownRef={mainMenuRef}
      >
        <div
          className="max-h-80 overflow-auto noscrollbar "
          onMouseMove={(e) => {
            pointerRef.current = { x: e.clientX, y: e.clientY };
          }}
        >
          {modelList.map((m) => {
            const displayName = formatModelDisplayName(m, variant);
            const isSelected = model === m;
            const isEffortMenuAnchor =
              hoveredModel === m && hoveredModelHasEffortMenu;
            return (
              <Button
                key={m}
                type="button"
                onClick={() => selectModel(m)}
                onMouseEnter={(e) =>
                  requestEffortMenu(
                    m,
                    e.currentTarget.getBoundingClientRect().top,
                    { x: e.clientX, y: e.clientY },
                  )
                }
                onMouseLeave={() => {
                  clearPendingRow();
                  scheduleEffortMenuClose();
                }}
                // Keyboard navigation has no travel path — bind immediately.
                onFocus={(e) =>
                  openEffortMenu(m, e.currentTarget.getBoundingClientRect().top)
                }
                onBlur={scheduleEffortMenuClose}
                className={`w-full text-left px-3 py-2 cursor-pointer text-sm transition-colors flex items-center gap-2 ${
                  isEffortMenuAnchor
                    ? "bg-primary-200/70 dark:bg-primary-800 text-primary-950 dark:text-primary"
                    : isSelected
                    ? "bg-primary-200/60 dark:bg-primary-200/10 text-primary-950 dark:text-primary "
                    : "hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300"
                }`}
                role="menuitemradio"
                aria-checked={isSelected}
                aria-haspopup={isEffortMenuAnchor ? "menu" : undefined}
                aria-expanded={isEffortMenuAnchor || undefined}
              >
                {getModelIcon(displayName, variant)}
                <span className="min-w-0 flex-1 truncate">{displayName}</span>
                {isSelected && <Check className="size-3.5 shrink-0" />}
              </Button>
            );
          })}
        </div>
      </DropdownWrapper>

      {isOpen &&
        hoveredModelHasEffortMenu &&
        hoveredModel &&
        effortMenuPosition &&
        createPortal(
          <div
            ref={effortMenuRef}
            onMouseEnter={() => {
              // Arrived — any row crossed on the way was travel, not intent.
              clearPendingRow();
              clearEffortCloseTimer();
            }}
            onMouseLeave={scheduleEffortMenuClose}
            className="fixed z-(--z-dropdown-sub) min-w-36 overflow-hidden rounded-2xl glass-card animate-dropdown-in"
            style={{
              top: effortMenuPosition.top,
              left: effortMenuPosition.left,
            }}
            role="menu"
            aria-label={`${hoveredModelDisplayName} ${
              hoveredModelEffortLevels.length > 0
                ? "effort level"
                : "thinking mode"
            }`}
          >
            <Text
              as="div"
              ref={effortMenuHeaderRef}
              size="xxs"
              tone="subtle"
              weight="medium"
              className="flex items-center gap-1.5 px-3 pb-1.5 pt-2 tracking-wide"
            >
              <span className="shrink-0">
                {getModelIcon(hoveredModelDisplayName, variant)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {hoveredModelDisplayName}
              </span>
              <span className="shrink-0">
                {hoveredModelEffortLevels.length > 0 ? "Effort" : "Thinking"}
              </span>
            </Text>

            {hoveredModelEffortLevels.length > 0 ? (
              <>
                {hoveredModelEffortLevels.map((level) => {
                  const isSelected =
                    hoveredModel === model &&
                    thinkingMode &&
                    effortLevel === level;
                  return (
                    <Button
                      key={level}
                      type="button"
                      onClick={() => selectEffortForHoveredModel(level)}
                      className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-sm capitalize transition-colors ${
                        isSelected
                          ? "bg-primary-200/60 text-primary-950 dark:bg-primary-200/10 dark:text-primary"
                          : "text-primary-700 hover:bg-primary-200/30 dark:text-primary-300 dark:hover:bg-primary-800"
                      }`}
                      role="menuitemradio"
                      aria-checked={isSelected}
                    >
                      <span className="flex-1">
                        {formatEffortLevel(level)}
                      </span>
                      {isSelected && <Check className="size-3.5 shrink-0" />}
                    </Button>
                  );
                })}

                {hoveredModelSupportsUltracode && (
                  <Button
                    type="button"
                    onClick={() =>
                      selectEffortForHoveredModel("ultracode")
                    }
                    className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors ${
                      hoveredModelHasSelectedUltracode
                        ? "bg-primary-200/60 dark:bg-primary-200/10"
                        : "hover:bg-primary-200/30 dark:hover:bg-primary-800"
                    }`}
                    role="menuitemradio"
                    aria-checked={hoveredModelHasSelectedUltracode}
                  >
                    <span
                      className={`flex-1 ${
                        hoveredModelHasSelectedUltracode
                          ? `font-medium ${ULTRACODE_GRADIENT_TEXT}`
                          : "text-primary-700 dark:text-primary-300"
                      }`}
                    >
                      Ultracode
                    </span>
                    {hoveredModelHasSelectedUltracode && (
                      <Check className="size-3.5 shrink-0 text-indigo-500 dark:text-indigo-400" />
                    )}
                  </Button>
                )}
              </>
            ) : (
              <>
                {[true, false].map((enabled) => {
                  const isSelected =
                    hoveredModel === model && thinkingMode === enabled;
                  return (
                    <Button
                      key={enabled ? "on" : "off"}
                      type="button"
                      onClick={() =>
                        selectThinkingForHoveredModel(enabled)
                      }
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                        isSelected
                          ? "bg-primary-200/60 text-primary-950 dark:bg-primary-200/10 dark:text-primary"
                          : "text-primary-700 hover:bg-primary-200/30 dark:text-primary-300 dark:hover:bg-primary-800"
                      }`}
                      role="menuitemradio"
                      aria-checked={isSelected}
                    >
                      <Brain className="size-4 shrink-0" />
                      <span className="flex-1">
                        {enabled ? "On" : "Off"}
                      </span>
                      {isSelected && (
                        <Check className="size-3.5 shrink-0" />
                      )}
                    </Button>
                  );
                })}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
