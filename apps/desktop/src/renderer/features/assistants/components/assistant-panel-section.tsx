import type { ComponentType, ReactNode, Ref, SVGProps } from "react";
import { Button } from "@/components/ui";
import { Plus } from "@/components/ui/icons";

interface AssistantPanelAction {
  label: string;
  onClick(): void;
  disabled?: boolean;
  isLoading?: boolean;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

export function AssistantPanelSection({ label, action, actionRef, viewportRef, children }: {
  label?: string;
  action?: AssistantPanelAction;
  actionRef?: Ref<HTMLButtonElement>;
  viewportRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const Icon = action?.icon ?? Plus;
  return <section aria-label={label} className="flex min-h-0 flex-1 flex-col">
    {action && <div className="flex shrink-0 justify-end px-5 pt-2">
      <Button ref={actionRef} variant="primary" disabled={action.disabled} isLoading={action.isLoading} onClick={action.onClick}
        leftIcon={<Icon aria-hidden="true" className="size-3.5" />}>{action.label}</Button>
    </div>}
    <div ref={viewportRef} className="scroll-bounce min-h-0 flex-1 space-y-3 overflow-y-auto scroll-pt-4 px-5 pt-4 pb-[calc(25dvh_+_1.5rem)] [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem)]">
      {children}
    </div>
  </section>;
}

export function AssistantPanelEmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl glass-card px-4 py-6 text-center text-sm leading-relaxed text-primary-600 dark:text-primary-400">{children}</p>;
}
