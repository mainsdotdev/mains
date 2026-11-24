import type { ReactNode } from "react";
import { Body, Button } from "@/components/ui";

export function TasksState({ title, description, role, children }: {
  title: string;
  description?: string;
  role?: "alert" | "status";
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Body
        role={role}
        size="s"
        weight={role === "status" ? "normal" : "medium"}
        tone={role === "status" ? "muted" : "default"}
      >
        {title}
      </Body>
      {description && <Body size="xs" tone="muted" className="max-w-90">{description}</Body>}
      {children}
    </div>
  );
}

export function TasksLoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <TasksState title={title} role="alert">
      <Button variant="subtle" onClick={onRetry}>Try again</Button>
    </TasksState>
  );
}
