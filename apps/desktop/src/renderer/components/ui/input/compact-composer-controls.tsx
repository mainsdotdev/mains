import { formatEffortLevel } from "@/lib/format";
import { useRef, useState, type ReactNode } from "react";
import DropdownWrapper from "../dropdown-wrapper";
import { Button } from "../button";
import Text from "../text";
import { ArrowUp, Brain, BoltFill, Check } from "../icons";
import { Bolt } from "../icons/space";
import { useClickOutside } from "@/hooks/use-click-outside";
import {
  formatModelDisplayName,
  getModelIcon,
  selectableModelNames,
} from "@/lib/model-icons";
import { ULTRACODE_GRADIENT_TEXT } from "./ultracode-styles";

type Variant = "claude" | "copilot" | "codex" | "cursor";
type EffortLevel = "minimal" | "low" | "medium" | "high" | "max" | "xhigh";

interface CompactComposerControlsProps {
  variant: Variant;
  model: string;
  models: string[];
  onModelChange: (model: string) => void;
  isLoadingModels: boolean;
  thinkingMode: boolean;
  effortLevel: string;
  onEffortLevelChange: (level: string) => void;
  onThinkingModeToggle: () => void;
  supportedEffortLevels?: EffortLevel[];
  supportsUltracode?: boolean;
  fastMode: boolean;
  onFastModeToggle: () => void;
  supportsFastMode: boolean;
}

/** A heading between groups of rows in the menu. */
const Section = ({ children }: { children: ReactNode }) => (
  <Text
    as="div"
    size="xxs"
    tone="subtle"
    className="px-2.5 pt-2.5 pb-1 uppercase tracking-wide"
  >
    {children}
  </Text>
);

const ROW =
  "w-full flex items-center gap-2 text-left px-2.5 py-2 text-sm cursor-pointer transition-colors";
const ROW_ACTIVE =
  "bg-primary-200/60 dark:bg-primary-200/10 text-primary-950 dark:text-primary";
const ROW_IDLE =
  "hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300";

/**
 * Mobile-only: merges model + reasoning effort + fast (speed) into a single flat
 * dropdown so the composer toolbar doesn't overflow with separate chips. Flat
 * sections (not hover flyouts) because the shared {@link DropdownMenuSub} opens on
 * hover and flies out sideways — neither works on touch / narrow screens.
 * Desktop keeps the individual chips.
 */
export function CompactComposerControls({
  variant,
  model,
  models,
  onModelChange,
  isLoadingModels,
  thinkingMode,
  effortLevel,
  onEffortLevelChange,
  onThinkingModeToggle,
  supportedEffortLevels,
  supportsUltracode,
  fastMode,
  onFastModeToggle,
  supportsFastMode,
}: CompactComposerControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  useClickOutside(containerRef, () => setIsOpen(false));

  const modelList = selectableModelNames(models, variant);
  const displayModel = formatModelDisplayName(model, variant);
  const hasEffortLevels =
    !!supportedEffortLevels && supportedEffortLevels.length > 0;
  const selectedEffortLabel =
    thinkingMode && effortLevel ? formatEffortLevel(effortLevel) : "";

  return (
    <div className="relative animate-blur-reveal" ref={containerRef}>
      <Button
        type="button"
        tooltip="Model & thinking"
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-center gap-1 px-2 py-1 rounded-full text-sm cursor-pointer text-primary-950 dark:text-primary hover:bg-primary-200/30 dark:hover:bg-primary-800 transition-colors"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {getModelIcon(displayModel, variant)}
        <span className="max-w-36 truncate">
          {isLoadingModels && !displayModel ? "…" : displayModel}
          {selectedEffortLabel && (
            <span
              className={`capitalize ${
                effortLevel === "ultracode"
                  ? `font-medium ${ULTRACODE_GRADIENT_TEXT}`
                  : "font-normal text-primary-600 dark:text-primary-400"
              }`}
            >
              {" "}
              {selectedEffortLabel}
            </span>
          )}
        </span>
        <ArrowUp className="size-3.5 rotate-180" />
      </Button>

      <DropdownWrapper
        isOpen={isOpen}
        aria-label="Composer controls"
        openUpward
        minWidth="min-w-52"
      >
        <div className="max-h-[60vh] overflow-auto noscrollbar py-1">
          {modelList.length > 0 && (
            <>
              <Section>Model</Section>
              {modelList.map((m) => {
                const name = formatModelDisplayName(m, variant);
                const active = model === m;
                return (
                  <Button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      onModelChange(m);
                      setIsOpen(false);
                    }}
                    className={`${ROW} ${active ? ROW_ACTIVE : ROW_IDLE}`}
                  >
                    {getModelIcon(name, variant)}
                    <span className="flex-1 truncate">{name}</span>
                    {active && <Check className="size-3.5 shrink-0" />}
                  </Button>
                );
              })}
            </>
          )}

          {hasEffortLevels ? (
            <>
              <Section>Reasoning</Section>
              {variant !== "codex" && (
                <Button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!thinkingMode}
                  onClick={() => {
                    onEffortLevelChange("");
                    setIsOpen(false);
                  }}
                  className={`${ROW} ${!thinkingMode ? ROW_ACTIVE : ROW_IDLE}`}
                >
                  <span className="flex-1">Off</span>
                  {!thinkingMode && <Check className="size-3.5 shrink-0" />}
                </Button>
              )}
              {supportedEffortLevels!.map((level) => {
                const active = thinkingMode && effortLevel === level;
                return (
                  <Button
                    key={level}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      onEffortLevelChange(level);
                      setIsOpen(false);
                    }}
                    className={`${ROW} capitalize ${active ? ROW_ACTIVE : ROW_IDLE}`}
                  >
                    <Brain className="size-3.5 shrink-0" />
                    <span className="flex-1">{formatEffortLevel(level)}</span>
                    {active && <Check className="size-3.5 shrink-0" />}
                  </Button>
                );
              })}
              {supportsUltracode && variant === "claude" && (
                <Button
                  type="button"
                  role="menuitemradio"
                  aria-checked={thinkingMode && effortLevel === "ultracode"}
                  onClick={() => {
                    onEffortLevelChange("ultracode");
                    setIsOpen(false);
                  }}
                  className={`${ROW} ${thinkingMode && effortLevel === "ultracode" ? ROW_ACTIVE : ROW_IDLE}`}
                >
                  <Brain
                    className={`size-3.5 shrink-0 ${
                      thinkingMode && effortLevel === "ultracode"
                        ? "text-accent"
                        : ""
                    }`}
                  />
                  <span
                    className={`flex-1 ${
                      thinkingMode && effortLevel === "ultracode"
                        ? `font-medium ${ULTRACODE_GRADIENT_TEXT}`
                        : ""
                    }`}
                  >
                    Ultracode
                  </span>
                  {thinkingMode && effortLevel === "ultracode" && (
                    <Check className="size-3.5 shrink-0" />
                  )}
                </Button>
              )}
            </>
          ) : variant === "claude" ? (
            <>
              <Section>Thinking</Section>
              <Button
                type="button"
                role="menuitemcheckbox"
                aria-checked={thinkingMode}
                onClick={() => {
                  onThinkingModeToggle();
                  setIsOpen(false);
                }}
                className={`${ROW} ${thinkingMode ? ROW_ACTIVE : ROW_IDLE}`}
              >
                <Brain className="size-3.5 shrink-0" />
                <span className="flex-1">{thinkingMode ? "On" : "Off"}</span>
                {thinkingMode && <Check className="size-3.5 shrink-0" />}
              </Button>
            </>
          ) : null}

          {supportsFastMode && (
            <>
              <Section>Speed</Section>
              <Button
                type="button"
                role="menuitemcheckbox"
                aria-checked={fastMode}
                onClick={() => {
                  onFastModeToggle();
                  setIsOpen(false);
                }}
                className={`${ROW} ${fastMode ? ROW_ACTIVE : ROW_IDLE}`}
              >
                {fastMode ? (
                  <BoltFill className="size-4 shrink-0 text-violet-500 dark:text-violet-400" />
                ) : (
                  <Bolt className="size-4 shrink-0" />
                )}
                <span className="flex-1">Fast</span>
                {fastMode && <Check className="size-3.5 shrink-0" />}
              </Button>
            </>
          )}
        </div>
      </DropdownWrapper>
    </div>
  );
}
