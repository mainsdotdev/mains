import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toastStore, toast as toastApi } from "./toast";
import Text from "../text";
import type { ToastItemProps, ToastType } from "./types";
import { Button } from "../button";
import { Error, Success } from "../icons";
import { AsciiSpinner } from "../ascii-spinner";
import {
  CONTENT_LEFT_VAR,
  CONTENT_RIGHT_VAR,
  LAYOUT_PANEL_ANIM_MS,
} from "@/lib/layout";

function getDefaultIcon(type: ToastType) {
  switch (type) {
    case "success":
      return <Success />;
    case "error":
      return <Error />;
    case "loading":
      return <AsciiSpinner />;
    default:
      return null;
  }
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [exiting, setExiting] = useState(false);
  const dismissedRef = useRef(false);

  // Auto-dismiss timer
  useEffect(() => {
    if (toast.duration === Infinity || exiting) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (!isPaused && !dismissedRef.current) {
      timeoutId = setTimeout(() => {
        if (!dismissedRef.current) {
          setExiting(true);
        }
      }, toast.duration);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [toast.id, toast.duration, isPaused, exiting]);

  // Handle exit animation then dismiss
  useEffect(() => {
    if (exiting && !dismissedRef.current) {
      const id = setTimeout(() => {
        dismissedRef.current = true;
        onDismiss(toast.id);
      }, 200);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [exiting, toast.id, onDismiss]);

  const icon = toast.icon ?? getDefaultIcon(toast.type);

  const handleDismiss = () => {
    if (!dismissedRef.current && !exiting) {
      setExiting(true);
    }
  };

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      data-exiting={exiting ? "" : undefined}
      className="pointer-events-auto inline-flex items-center gap-3 px-5 py-3
        rounded-full max-w-[calc(100vw-24px)] glass-outline bg-primary dark:bg-primary-950
        text-primary-950 dark:text-primary toast-item"
    >
      {icon && <span className="flex items-center">{icon}</span>}
      {/* Colour comes from the toast shell, which owns the surface it sits on. */}
      <Text as="span" tone="inherit" weight="medium" className="whitespace-nowrap">
        {toast.message}
      </Text>
      {toast.action && (
        <Button
          onClick={(e) => {
            e.stopPropagation();
            toast.action?.onClick();
            handleDismiss();
          }}
          className="text-sm font-semibold text-accent transition-colors"
        >
          {toast.action.label}
        </Button>
      )}
    </div>
  );
}

export function Toaster() {
  const toasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getSnapshot,
    toastStore.getSnapshot,
  );

  // Keyboard dismiss (Escape dismisses top toast)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && toasts.length > 0) {
        toastApi.dismiss(toasts[0].id);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toasts]);

  const handleDismiss = useCallback((id: string) => {
    toastApi.dismiss(id);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-0 flex flex-col items-center pt-10 gap-2.5 pointer-events-none"
      style={{
        zIndex: 99999,
        // Center over the content column, not the window: the edges published
        // by AppContent fold in the sidebar, right-lane panel, and docked
        // session box. Same duration as MainContent's margin transition so
        // toasts slide with the panels instead of jumping.
        left: `var(${CONTENT_LEFT_VAR}, 0px)`,
        right: `var(${CONTENT_RIGHT_VAR}, 0px)`,
        transition: `left ${LAYOUT_PANEL_ANIM_MS}ms ease-out, right ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
      }}
      aria-label="Notifications"
    >
      {toasts.map((t, index) => (
        <ToastItem
          key={t.id}
          toast={t}
          index={index}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
}
