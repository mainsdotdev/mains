import { Compact } from "@/components/ui/icons";
import { Text } from "@/components/ui";

export function ContextCompactionActivity({ active }: { active: boolean }) {
  const label = active ? "Compacting context…" : "Context compaction interrupted";
  return (
    <div role="status" aria-label={label} className="flex min-w-0 items-center gap-2 text-primary-500">
      <Compact aria-hidden="true" className="size-4 shrink-0" />
      <Text as="span" size="sm" tone="inherit" className={active ? "shine-text" : undefined}>
        {label}
      </Text>
    </div>
  );
}

export function ContextCompactionSeparator() {
  return (
    <div role="separator" aria-label="Context compacted" className="my-6 flex items-center gap-3 text-xs text-primary-500 dark:text-primary-400">
      <span aria-hidden="true" className="min-w-0 flex-1 border-t border-dashed border-primary-300/80 dark:border-primary-800" />
      <span className="flex shrink-0 items-center gap-1.5">
        <Compact aria-hidden="true" className="size-4" />
        Context compacted
      </span>
      <span aria-hidden="true" className="min-w-0 flex-1 border-t border-dashed border-primary-300/80 dark:border-primary-800" />
    </div>
  );
}
