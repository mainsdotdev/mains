import type { ReactNode } from "react";

export function SidebarTopRows({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col px-3 pt-11 md:pt-1">
      <div className="flex h-8 items-center">{header}</div>
      <div className="relative my-2">{children}</div>
    </div>
  );
}
