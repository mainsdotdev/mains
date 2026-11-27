import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ASSISTANT_ROBOT_AVATARS, isAssistantRobotShape, type AssistantAvatar as Avatar, type AssistantRobotShape } from "@mains/contracts/assistants";
import { Button, HorizontalFadeScroller, SegmentedTabs } from "@/components/ui";
import { cn } from "@/lib/cn";
import { DEFAULT_ROBOT_AVATAR, ROBOT_PRESETS, ROBOT_SHAPES_BY_STYLE, ROBOT_STYLES, ROBOT_STYLE_LABELS, type RobotStyle } from "../lib/assistant-robot-presets";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantRobotAvatar, AssistantRobotPreview } from "./assistant-robot-avatar";

const ROBOT_STYLE_OPTIONS = ROBOT_STYLES.map(value => ({ value, label: ROBOT_STYLE_LABELS[value] }));
const VARIANT_FADE_WIDTH = 48;

export function AssistantAvatarPicker({ avatar, seed, onChange, nameField, compact = false }: {
  avatar: Avatar;
  seed: string;
  onChange(avatar: Avatar): void;
  nameField?: ReactNode;
  compact?: boolean;
}) {
  const selectedShape = isAssistantRobotShape(avatar.shape) ? avatar.shape : undefined;
  const style = ROBOT_PRESETS[selectedShape ?? DEFAULT_ROBOT_AVATAR.shape].style;
  const shapes = ROBOT_SHAPES_BY_STYLE[style];
  const fadeVariants = !compact && style === "specialists";
  const previewSize = compact ? "size-20" : "size-32";
  const previousShapes = useRef<Partial<Record<RobotStyle, AssistantRobotShape>>>({});
  const styleViewport = useRef<HTMLDivElement>(null);
  const variantViewport = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const viewport = styleViewport.current;
    if (!viewport) return;
    const reveal = () => revealOption(viewport, viewport.querySelector('[aria-checked="true"]'));
    reveal();
    const resize = new ResizeObserver(reveal);
    resize.observe(viewport);
    return () => resize.disconnect();
  }, [style]);

  useLayoutEffect(() => {
    revealOption(variantViewport.current, selectedButton.current, fadeVariants ? VARIANT_FADE_WIDTH : 0);
  }, [selectedShape, compact, fadeVariants]);

  function selectShape(shape: AssistantRobotShape) {
    onChange({ shape, color: ASSISTANT_ROBOT_AVATARS[shape] });
  }

  function selectStyle(nextStyle: RobotStyle) {
    if (selectedShape) {
      if (style === nextStyle) return;
      previousShapes.current[style] = selectedShape;
    }
    selectShape(previousShapes.current[nextStyle] ?? ROBOT_SHAPES_BY_STYLE[nextStyle][0]);
  }

  const variants = (
    <div role="radiogroup" aria-label="Robot variant" onKeyDown={event => cycleAvatar(event, shapes, selectedShape ?? shapes[0], selectShape)}
      className={cn("flex w-max items-center px-1 py-1", compact ? "gap-1" : "gap-1.5")}>
      {shapes.map(shape => {
        const selected = selectedShape === shape;
        const { label } = ROBOT_PRESETS[shape];
        return <Button key={shape} ref={selected ? selectedButton : undefined} variant="bare" role="radio" aria-label={label} tooltip={label} tooltipPosition="bottom"
          tabIndex={shape === (selectedShape ?? shapes[0]) ? 0 : -1} aria-checked={selected}
          onClick={() => selectShape(shape)}
          className={cn("flex shrink-0 items-center justify-center rounded-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            compact ? "size-9" : "size-12",
            selected ? "bg-primary-300/20 ring-1 ring-inset ring-primary-400/40 dark:bg-primary/10 dark:ring-primary/20" : "hover:bg-primary-300/20 dark:hover:bg-primary/5")}>
          <AssistantRobotAvatar shape={shape} className={compact ? "size-8" : "size-10"} />
        </Button>;
      })}
    </div>
  );

  return <div className={cn("flex flex-col items-center", compact ? "gap-3" : "gap-5 pb-4 pt-2 sm:gap-6")}>
    <div className="flex w-full flex-col items-center gap-1">
      {selectedShape
        ? <AssistantRobotPreview shape={selectedShape} presentation="picker" className={previewSize} />
        : <AssistantAvatar avatar={avatar} seed={seed} className={previewSize} />}
      {nameField}
    </div>
    <div ref={styleViewport} className="max-w-full overflow-x-auto overscroll-x-contain">
      <SegmentedTabs value={style} options={ROBOT_STYLE_OPTIONS} onChange={selectStyle}
        semantics="radiogroup" aria-label="Robot style" className="w-max" />
    </div>
    {fadeVariants ? (
      <div className="max-w-full">
        <HorizontalFadeScroller ref={variantViewport} arrows className="overscroll-x-contain" contentClassName="w-max">
          {variants}
        </HorizontalFadeScroller>
      </div>
    ) : (
      <div ref={variantViewport} className="max-w-full overflow-x-auto overscroll-x-contain">
        {variants}
      </div>
    )}
  </div>;
}

function revealOption(viewport: HTMLElement | null, button: HTMLElement | null, inset = 0) {
  if (!viewport || !button || viewport.scrollWidth <= viewport.clientWidth) return;
  const bounds = viewport.getBoundingClientRect();
  const selected = button.getBoundingClientRect();
  if (selected.left < bounds.left + inset) viewport.scrollLeft += selected.left - bounds.left - inset - 4;
  else if (selected.right > bounds.right - inset) viewport.scrollLeft += selected.right - bounds.right + inset + 4;
}

function cycleAvatar<T extends string>(event: KeyboardEvent<HTMLDivElement>, values: readonly T[], value: T, choose: (value: T) => void) {
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (!step && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const index = event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : (values.indexOf(value) + step + values.length) % values.length;
  choose(values[index]);
  event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus({ preventScroll: true });
}
