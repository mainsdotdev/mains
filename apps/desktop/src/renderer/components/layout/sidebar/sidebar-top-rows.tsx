import type { ReactNode } from "react";

export function SidebarTopRows({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="shrink-0 px-3 pt-11 pb-3 md:pt-1">
      <div className="flex h-8 items-center">{header}</div>
      <div className="relative mt-2 h-8">{children}</div>
    </div>
  );
}
