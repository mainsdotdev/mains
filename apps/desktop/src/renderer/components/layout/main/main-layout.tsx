import type { CSSProperties, ReactNode } from "react";
import { useCapabilities } from "@/lib/platform";
import { cn } from "@/lib/cn";

interface MainLayoutProps {
  children: ReactNode;
  className?: string;
}

export function MainLayout({ children, className }: MainLayoutProps) {
  const { windowsWindowChrome } = useCapabilities();
  return (
    // `--app-frame` comes from index.css, or from the app theme in force.
    <div className={cn("app-root flex flex-col h-screen bg-(--app-frame) transition-colors duration-300 ease-in-out", className)}
      style={windowsWindowChrome ? { paddingTop: "env(titlebar-area-height, 38px)" } : undefined}>
      <DragRegion nativeTitleBar={windowsWindowChrome} />
      {/* Fixed panels use the client viewport below Windows' native buttons. */}
      <div className="flex h-full" style={windowsWindowChrome ? { contain: "layout" } : undefined}>
        {windowsWindowChrome && <DragRegion />}
        {children}
      </div>
    </div>
  );
}

function DragRegion({ nativeTitleBar = false }: { nativeTitleBar?: boolean }) {
  const { windowChrome } = useCapabilities();
  // No window to drag in a browser; the strip would only intercept top-edge
  // clicks (WebkitAppRegion is ignored there anyway).
  if (!windowChrome) return null;
  return (
    <div
      className="fixed top-0 left-0 right-0 z-(--z-overlay)"
      style={{ height: nativeTitleBar ? "env(titlebar-area-height, 38px)" : "var(--drag-region-height)", WebkitAppRegion: "drag" } as CSSProperties}
    />
  );
}
