import type { KeyboardEvent } from "react";
import { ASSISTANT_AVATAR_COLORS, ASSISTANT_AVATAR_SHAPES, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MOSAIC_SHAPES } from "../lib/assistant-mosaic";
import { AssistantAvatar, AVATAR_COLORS } from "./assistant-avatar";

export function AssistantAvatarPicker({ avatar, seed, onChange, compact = false }: {
  avatar: Avatar;
  seed: string;
  onChange(avatar: Avatar): void;
  compact?: boolean;
}) {
  return <div className={cn("flex flex-col items-center", compact ? "gap-3" : "gap-5 pb-4 pt-2 sm:gap-6")}>
    <AssistantAvatar avatar={avatar} seed={seed} className={compact ? "size-14" : "size-28"} />
    <div className="max-w-full overflow-x-auto overscroll-x-contain">
      <div role="radiogroup" aria-label="Avatar shape" onKeyDown={event => cycleAvatar(event, ASSISTANT_AVATAR_SHAPES, avatar.shape, shape => onChange({ ...avatar, shape }))} className="flex w-max items-center gap-1.5 px-1 py-1">
        {ASSISTANT_AVATAR_SHAPES.map(shape => {
          const selected = avatar.shape === shape;
          const label = MOSAIC_SHAPES[shape].label;
          return <Button key={shape} variant="bare" role="radio" aria-label={label} tooltip={label} tabIndex={selected ? 0 : -1} aria-checked={selected}
            onClick={() => onChange({ ...avatar, shape })}
            className={cn("flex shrink-0 items-center justify-center rounded-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
              compact ? "size-9" : "size-11",
              selected ? "bg-primary-300/20 ring-1 ring-inset ring-primary-400/40 dark:bg-primary/10 dark:ring-primary/20" : "hover:bg-primary-300/20 dark:hover:bg-primary/5")}>
            <AssistantAvatar avatar={{ ...avatar, shape }} animated={false} className={compact ? "size-7" : "size-9"} />
          </Button>;
        })}
      </div>
    </div>
    <div role="radiogroup" aria-label="Avatar color" onKeyDown={event => cycleAvatar(event, ASSISTANT_AVATAR_COLORS, avatar.color, color => onChange({ ...avatar, color }))} className={cn("grid grid-cols-4 gap-3", !compact && "sm:grid-cols-8")}>
      {ASSISTANT_AVATAR_COLORS.map(color => <Button key={color} type="button" variant="bare" role="radio" tabIndex={avatar.color === color ? 0 : -1} aria-label={AVATAR_COLORS[color].label} aria-checked={avatar.color === color} onClick={() => onChange({ ...avatar, color })}
        className={`flex size-7 items-center justify-center rounded-full outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent ${avatar.color === color ? "ring-2 ring-accent ring-offset-3 ring-offset-primary dark:ring-offset-primary-950" : "hover:scale-110"}`} style={{ backgroundColor: AVATAR_COLORS[color].fill }} />)}
    </div>
  </div>;
}

function cycleAvatar<T extends string>(event: KeyboardEvent<HTMLDivElement>, values: readonly T[], value: T, choose: (value: T) => void) {
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (!step && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const index = event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : (values.indexOf(value) + step + values.length) % values.length;
  choose(values[index]);
  event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
}
