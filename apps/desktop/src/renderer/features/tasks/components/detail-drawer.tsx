import { useState, type ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setTasksDetailWidth } from "@/lib/redux/slices/appSettingsSlice";
import { ResizeHandle } from "@/components/layout/resize-handle";
import {
  TASKS_DETAIL_WIDTH_DEFAULT,
  TASKS_DETAIL_WIDTH_MIN,
  TASKS_DETAIL_WIDTH_MAX,
} from "@/lib/layout";
import { useIsMobile } from "@/lib/platform";

/**
 * The right-hand detail drawer on /tasks. Sits in the page's flex row (pushes
 * the list, doesn't overlay it) and is drag-resizable on its left edge; the
 * width persists in appSettings.
 */
export function DetailDrawer({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const isMobile = useIsMobile();
  const width = useAppSelector((s) => s.appSettings.tasksDetailWidth);
  // Live width during a drag; null when idle (committed value drives layout).
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);

  return (
    <div
      className="relative shrink-0 h-full min-h-0 flex flex-col border-l border-primary-200/60 dark:border-primary-800/50 bg-primary dark:bg-primary-950"
      style={isMobile ? { width: "100%" } : { width: previewWidth ?? width, maxWidth: "85vw" }}
    >
      <ResizeHandle
        edge="left"
        value={previewWidth ?? width}
        min={TASKS_DETAIL_WIDTH_MIN}
        max={TASKS_DETAIL_WIDTH_MAX}
        computeWidth={(clientX) => window.innerWidth - clientX}
        onPreview={setPreviewWidth}
        onCommit={(w) => {
          dispatch(setTasksDetailWidth(w));
          setPreviewWidth(null);
        }}
        onReset={() => {
          dispatch(setTasksDetailWidth(TASKS_DETAIL_WIDTH_DEFAULT));
          setPreviewWidth(null);
        }}
        ariaLabel="Resize detail panel"
      />
      {/* pt-16 mirrors the list column's PageShell-style top offset so the
          detail header lines up with the "Tasks" heading. */}
      <div className="flex-1 min-h-0 flex flex-col pt-16">{children}</div>
    </div>
  );
}
