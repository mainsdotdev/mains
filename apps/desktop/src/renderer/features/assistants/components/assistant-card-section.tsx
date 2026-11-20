import { useId, type ReactNode } from "react";

export function AssistantCardSection({ title, label, status, as: Container = "section", children }: {
  title: string;
  label?: string;
  status?: string;
  as?: "section" | "li";
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Container aria-label={label} aria-labelledby={Container === "section" && !label ? titleId : undefined} className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-1.5 px-2.5 text-xs text-primary-600 dark:text-primary-400">
        <h3 id={titleId} className="font-medium">{title}</h3>
        {status && <><span aria-hidden="true">·</span><span>{status}</span></>}
      </div>
      {children && <div className="min-w-0 space-y-1 rounded-xl bg-primary-200/55 px-2.5 py-2 dark:bg-primary-950/45">
        {children}
      </div>}
    </Container>
  );
}
