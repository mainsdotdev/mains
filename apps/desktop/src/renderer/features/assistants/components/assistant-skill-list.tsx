import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { AssistantSkill } from "@mains/contracts/assistants";
import { Button } from "@/components/ui";
import { ArrowUp, Close, Skill, Warning } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type SkillListProps = {
  skills: AssistantSkill[];
  disabled: boolean;
  onRemove?: (id: string) => void;
};

export function AssistantSkillList({ skills, disabled, onRemove, unavailable = false }: SkillListProps & { unavailable?: boolean }) {
  const viewport = useRef<HTMLUListElement>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  const updateScrollFade = useCallback(() => {
    const list = viewport.current;
    if (list) setHasMoreBelow(list.scrollHeight - list.scrollTop - list.clientHeight > 1);
  }, []);

  useLayoutEffect(() => {
    updateScrollFade();
  }, [skills.length, updateScrollFade]);

  // The scroll viewport fits two rows and the gap between them.
  return <ul ref={viewport} aria-label={unavailable ? "Unavailable skill list" : "Active skills"} tabIndex={skills.length > 2 ? 0 : undefined}
    onScroll={updateScrollFade} className={cn(
      "max-h-34 space-y-2 overflow-y-auto",
      hasMoreBelow && "[mask-image:linear-gradient(to_bottom,black_calc(100%_-_1.5rem),transparent)]",
    )}>
    {skills.map(skill => <li key={skill.id} className={cn(
      "flex h-16 min-w-0 items-center gap-3 rounded-xl px-3 py-1",
      unavailable ? "bg-primary-950/3 dark:bg-primary/4" : "bg-primary-950/5 dark:bg-primary/7",
    )}>
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary-950/6 text-primary-600 dark:bg-primary/9 dark:text-primary-300">
        <Skill aria-hidden="true" className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p title={skill.name} className="truncate font-medium leading-5">{skill.name}</p>
        {!!skill.description && <p title={skill.description} className="mt-0.5 line-clamp-2 wrap-break-word text-xs leading-4 text-primary-600 dark:text-primary-400">
          {skill.description}
        </p>}
      </div>
      {onRemove && <Button variant="icon" iconSize="lg" aria-label={`Remove ${skill.name}`} tooltip="Remove skill"
        disabled={disabled} onClick={() => onRemove(skill.id)}><Close aria-hidden="true" /></Button>}
    </li>)}
  </ul>;
}

export function UnavailableAssistantSkills(props: SkillListProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return <div className="glass-outline rounded-xl">
    <Button aria-label={`Unavailable skills, ${props.skills.length}`} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}
      className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-s text-primary-700 hover:bg-primary-950/5 dark:text-primary-300 dark:hover:bg-primary/5">
      <Warning aria-hidden="true" className="size-4 shrink-0 text-warning" />
      <span className="flex-1 font-medium">Unavailable skills</span>
      <span className="tabular-nums text-primary-600 dark:text-primary-400">{props.skills.length}</span>
      <ArrowUp aria-hidden="true" className={cn("size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none", open ? "rotate-180" : "rotate-90")} />
    </Button>
    <div id={bodyId} inert={!open} aria-hidden={!open} className={cn(
      "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
      open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
    )}>
      <div className="min-h-0 overflow-hidden">
        <div className="p-2"><AssistantSkillList {...props} unavailable /></div>
      </div>
    </div>
  </div>;
}
