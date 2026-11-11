import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Shared 50px content toolbar for browser, document and app previews. */
export function PreviewToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="toolbar" {...props} data-preview-toolbar=""
    className={cn("flex h-12.5 min-w-0 shrink-0 items-center gap-1 border-b border-primary-200/60 bg-primary px-2 py-1 text-primary-900 dark:border-primary-800/50 dark:bg-primary-950 dark:text-primary-100", className)} />;
}
