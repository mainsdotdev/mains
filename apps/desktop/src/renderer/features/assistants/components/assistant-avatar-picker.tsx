import { useRef, type KeyboardEvent } from "react";
import { ASSISTANT_AVATAR_COLORS, ASSISTANT_AVATAR_SHAPES_BY_FAMILY, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { assistantAvatarDesign, AVATAR_FAMILIES } from "../lib/assistant-avatar-design";
import { AssistantAvatar, AVATAR_COLORS } from "./assistant-avatar";

type AvatarFamily = typeof AVATAR_FAMILIES[number];
const FAMILY_LABELS: Record<AvatarFamily, string> = { mosaic: "Mosaic", badge: "Badge", felt: "Felt" };

export function AssistantAvatarPicker({ avatar, seed, onChange, compact = false }: {
  avatar: Avatar;
  seed: string;
  onChange(avatar: Avatar): void;
  compact?: boolean;
}) {
  const { family } = assistantAvatarDesign(avatar.shape);
  const shapes = ASSISTANT_AVATAR_SHAPES_BY_FAMILY[family];
  const previousShapes = useRef<Partial<Record<AvatarFamily, Avatar["shape"]>>>({});
  function selectFamily(nextFamily: AvatarFamily) {
    if (family === nextFamily) return;
    previousShapes.current[family] = avatar.shape;
    onChange({ ...avatar, shape: previousShapes.current[nextFamily] ?? ASSISTANT_AVATAR_SHAPES_BY_FAMILY[nextFamily][0] });
  }

  return <div className={cn("flex flex-col items-center", compact ? "gap-3" : "gap-5 pb-4 pt-2 sm:gap-6")}>
    <AssistantAvatar avatar={avatar} seed={seed} className={compact ? "size-14" : "size-28"} />
    <div role="radiogroup" aria-label="Avatar style" onKeyDown={event => cycleAvatar(event, AVATAR_FAMILIES, family, selectFamily)}
      className="flex max-w-full flex-wrap justify-center gap-1 rounded-2xl bg-primary-200/30 p-1 dark:bg-primary/5">
      {AVATAR_FAMILIES.map(option => {
        const selected = family === option;
        return <Button key={option} variant="bare" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
          onClick={() => selectFamily(option)}
          className={cn("flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            selected ? "bg-primary ring-1 ring-inset ring-primary-400/30 dark:bg-primary/10 dark:ring-primary/15"
              : "text-primary-600 hover:bg-primary-300/20 dark:text-primary-400 dark:hover:bg-primary/5")}>
          <AssistantAvatar avatar={{ ...avatar, shape: ASSISTANT_AVATAR_SHAPES_BY_FAMILY[option][0] }} animated={false} className="size-5" />
          {FAMILY_LABELS[option]}
        </Button>;
      })}
    </div>
    <div className="max-w-full overflow-x-auto overscroll-x-contain">
      <div role="radiogroup" aria-label="Avatar shape" onKeyDown={event => cycleAvatar(event, shapes, avatar.shape, shape => onChange({ ...avatar, shape }))} className="flex w-max items-center gap-1.5 px-1 py-1">
        {shapes.map(shape => {
          const selected = avatar.shape === shape;
          const { label } = assistantAvatarDesign(shape);
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
