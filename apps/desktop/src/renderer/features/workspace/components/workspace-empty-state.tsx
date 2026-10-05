import { Mains } from "@/components/ui/icons";

export function WorkspaceEmptyState() {
  return (
    <div className="flex flex-col items-center py-2 text-center shrink-0 w-full max-w-210">
      <Mains
        className="h-12 w-auto shrink-0 text-primary-200 dark:text-primary-800"
        aria-hidden
      />
    </div>
  );
}
