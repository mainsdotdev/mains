import type { CSSProperties, ReactNode } from "react";
import { useCapabilities } from "@/lib/platform";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    // `--app-frame` comes from index.css, or from the app theme in force.
    <div className="app-root flex flex-col h-screen bg-(--app-frame) transition-colors duration-300 ease-in-out">
      <DragRegion />
      <div className="flex h-full">{children}</div>
    </div>
  );
}

function DragRegion() {
  const { windowChrome } = useCapabilities();
  // No window to drag in a browser; the strip would only intercept top-edge
  // clicks (WebkitAppRegion is ignored there anyway).
  if (!windowChrome) return null;
  return (
    <div
      className="fixed top-0 left-0 right-0 z-(--z-overlay)"
      style={{ height: "var(--drag-region-height)", WebkitAppRegion: "drag" } as CSSProperties}
    />
  );
}
