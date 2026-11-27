import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AssistantSkill } from "@mains/contracts/assistants";
import { Button } from "@/components/ui";
import { Close, Skill } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type SkillListProps = {
  skills: AssistantSkill[];
  disabled: boolean;
  onRemove?: (id: string) => void;
};

export function AssistantSkillList({ skills, disabled, onRemove, unavailable = false }: SkillListProps & { unavailable?: boolean }) {
  const viewport = useRef<HTMLUListElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  const updateScrollFade = useCallback(() => {
    const list = viewport.current;
    if (!list) return;
    const maxScrollTop = list.scrollHeight - list.clientHeight;
    setHasOverflow(maxScrollTop > 1);
    setHasMoreBelow(maxScrollTop - list.scrollTop > 1);
  }, []);

  useLayoutEffect(() => {
    updateScrollFade();
    if (!viewport.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateScrollFade);
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [skills.length, updateScrollFade]);

  // Four 3.5rem rows and three 0.375rem gaps fit in the full viewport.
  return <ul ref={viewport} aria-label={unavailable ? "Unavailable skill list" : "Active skills"} tabIndex={hasOverflow ? 0 : undefined}
    onScroll={updateScrollFade} className={cn(
      "min-h-14 max-h-60.5 space-y-1.5 overflow-y-auto",
      hasMoreBelow && "[mask-image:linear-gradient(to_bottom,black_calc(100%_-_1.25rem),transparent)]",
    )}>
    {skills.map(skill => <li key={skill.id} className={cn(
      "flex h-14 min-w-0 items-center gap-2.5 rounded-xl px-3 py-0.5",
      unavailable ? "bg-primary-950/3 dark:bg-primary/4" : "bg-primary-950/5 dark:bg-primary/7",
    )}>
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-primary-950/6 text-primary-600 dark:bg-primary/9 dark:text-primary-300">
        <Skill aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p title={skill.name} className="truncate font-medium leading-5">{skill.name}</p>
        {!!skill.description && <p title={skill.description} className="line-clamp-2 wrap-break-word text-xs leading-tight text-primary-600 dark:text-primary-400">
          {skill.description}
        </p>}
      </div>
      {onRemove && <Button variant="icon" iconSize="lg" aria-label={`Remove ${skill.name}`} tooltip="Remove skill"
        disabled={disabled} onClick={() => onRemove(skill.id)}><Close aria-hidden="true" /></Button>}
    </li>)}
  </ul>;
}
