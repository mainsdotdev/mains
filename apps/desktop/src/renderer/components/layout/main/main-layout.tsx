import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "@/hooks/use-theme";
import { useCapabilities } from "@/lib/platform";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const theme = useTheme();

  const backgroundStyle = theme.backgroundColor?.startsWith("linear-gradient")
    ? { background: theme.backgroundColor }
    : { backgroundColor: theme.backgroundColor };

  return (
    <div
      className="app-root flex flex-col h-screen"
      style={{
        ...backgroundStyle,
        transition:
          "background 300ms ease-in-out, background-color 300ms ease-in-out",
      }}
    >
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
