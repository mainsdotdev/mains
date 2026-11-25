import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui";
import { ChevronLeft } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setTasksDetailWidth } from "@/lib/redux/slices/appSettingsSlice";
import { ResizeHandle } from "@/components/layout/resize-handle";
import {
  TASKS_DETAIL_WIDTH_DEFAULT,
  TASKS_DETAIL_WIDTH_MIN,
  TASKS_DETAIL_WIDTH_MAX,
  clamp,
} from "@/lib/layout";

export function DetailDrawer({ compact, visible, maxWidth, backRef, onBack, children }: {
  compact: boolean;
  visible: boolean;
  maxWidth: number;
  backRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  children: ReactNode;
}) {
  const dispatch = useAppDispatch();
  const drawerRef = useRef<HTMLElement>(null);
  const width = useAppSelector((s) => s.appSettings.tasksDetailWidth);
  // Live width during a drag; null when idle (committed value drives layout).
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const max = Math.min(TASKS_DETAIL_WIDTH_MAX, maxWidth);
  const splitWidth = clamp(previewWidth ?? width, TASKS_DETAIL_WIDTH_MIN, max);

  return (
    <section
      ref={drawerRef}
      aria-label="Task details"
      className={cn(
        "relative h-full min-h-0 min-w-0 flex-col bg-primary dark:bg-primary-950",
        visible ? "flex" : "hidden",
        compact ? "flex-1" : "shrink-0 border-l border-primary-200/60 dark:border-primary-800/50",
      )}
      style={compact ? undefined : { width: splitWidth }}
    >
      {compact ? (
        <div className="shrink-0 px-6 pt-6 pb-2">
          <Button ref={backRef} variant="subtle" onClick={onBack}>
            <ChevronLeft className="size-3.5" aria-hidden="true" />
            Back to tasks
          </Button>
        </div>
      ) : (
        <ResizeHandle
          edge="left"
          value={splitWidth}
          min={TASKS_DETAIL_WIDTH_MIN}
          max={max}
          computeWidth={(clientX) => (drawerRef.current?.getBoundingClientRect().right ?? window.innerWidth) - clientX}
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
      )}
      <div className={cn("flex-1 min-h-0 flex flex-col", !compact && "pt-16")}>{children}</div>
    </section>
  );
}
