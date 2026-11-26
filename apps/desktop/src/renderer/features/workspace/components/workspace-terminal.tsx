import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { TerminalSession } from "@mains/contracts/terminal";
import {
  Button,
  getSegmentedTabId,
  HorizontalFadeScroller,
  SegmentedTabs,
  Text,
  toast,
} from "@/components/ui";
import { Close, Plus, Trash } from "@/components/ui/icons";
import {
  useCreateTerminalMutation,
  useGetTerminalSessionsQuery,
  useStopTerminalMutation,
} from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  forgetTerminal,
  selectTerminal,
  terminalWorkspaceKey,
} from "@/lib/redux/slices/terminalSlice";
import { useOverlayAnimation } from "@/hooks/use-overlay-lifecycle";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import {
  BOTTOM_TERMINAL_ANIM_MS,
  BOTTOM_TERMINAL_CONTENT_HEIGHT,
  BOTTOM_TERMINAL_EASE,
  BOTTOM_TERMINAL_HEIGHT,
} from "@/lib/layout";

type TerminalViewLoad = { module: typeof import("./xterm-terminal") } | { error: unknown };

export function WorkspaceTerminal({
  workspaceId,
  workspaceName,
  rootPath,
  isOpen,
  onHide,
}: {
  workspaceId: string;
  workspaceName: string;
  rootPath: string;
  isOpen: boolean;
  onHide: () => void;
}) {
  const dispatch = useAppDispatch();
  const backendId = useAppSelector(
    (state) => state.backends.activeBackendId ?? "local",
  );
  const key = terminalWorkspaceKey(backendId, workspaceId);
  const selectedId = useAppSelector(
    (state) => state.terminal.selectedByWorkspace[key],
  );
  const query = useGetTerminalSessionsQuery();
  const [create, creation] = useCreateTerminalMutation();
  const [stop, stopping] = useStopTerminalMutation();
  const attempted = useRef<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const { isVisible } = useOverlayAnimation(isOpen, {
    exitMs: reducedMotion ? 0 : BOTTOM_TERMINAL_ANIM_MS,
    immediate: true,
  });
  const drawerRef = useRef<HTMLDivElement>(null);
  const [canMountTerminal, setCanMountTerminal] = useState(isOpen);
  const [terminalView, setTerminalView] = useState<TerminalViewLoad | null>(null);
  const [lastVisible, setLastVisible] = useState<{
    key: string;
    sessions: TerminalSession[];
    active?: TerminalSession;
  } | null>(null);
  const tabsId = useId();
  const panelId = `${tabsId}-panel`;
  const sessions = useMemo(
    () => (query.currentData ?? []).filter((session) => session.workspaceId === workspaceId),
    [query.currentData, workspaceId],
  );
  const previous = lastVisible?.key === key ? lastVisible : null;
  const active =
    sessions.find((session) => session.id === selectedId) ??
    sessions.find((session) => session.id === previous?.active?.id) ??
    sessions[0];
  // Keep the painted tab through catalog lag on create and idle cleanup on exit.
  if (isOpen && (previous?.sessions !== sessions || previous.active !== active)) {
    setLastVisible({ key, sessions, active });
  } else if (!isOpen && !isVisible && lastVisible) {
    setLastVisible(null);
  }
  if (!isOpen && !isVisible && canMountTerminal) {
    setCanMountTerminal(false);
  } else if (isOpen && reducedMotion && !canMountTerminal) {
    setCanMountTerminal(true);
  }
  const displayed = isOpen ? { sessions, active } : isVisible ? previous : null;
  const displayedActive = displayed?.active;
  const needsTerminalView = isOpen && canMountTerminal && !!displayedActive;

  useEffect(() => {
    if (!isOpen || canMountTerminal) return;

    // Let the drawer paint at its final size before xterm opens, fits its
    // grid and replays output. A reversal keeps any view already mounted.
    let cancelled = false;
    const reveal = () => {
      if (!cancelled) frame = requestAnimationFrame(() => setCanMountTerminal(true));
    };
    let frame = requestAnimationFrame(() => {
      const slide = drawerRef.current?.getAnimations?.().find(
        (animation) => "transitionProperty" in animation && animation.transitionProperty === "height",
      );
      if (slide) void slide.finished.then(reveal, reveal);
      else reveal();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [canMountTerminal, isOpen]);

  useEffect(() => {
    if (!needsTerminalView || terminalView) return;
    let cancelled = false;
    void import("./xterm-terminal").then(
      (module) => { if (!cancelled) setTerminalView({ module }); },
      (error: unknown) => { if (!cancelled) setTerminalView({ error }); },
    );
    return () => { cancelled = true; };
  }, [needsTerminalView, terminalView]);

  const addTerminal = useCallback(
    async (initial = false) => {
      try {
        // Rapid hide/remounts can overlap the first create request. The stable
        // initial id lets the backend attach both requests to the same shell.
        const id = initial
          ? `terminal-${workspaceId}`
          : `terminal-${crypto.randomUUID()}`;
        const result = await create({
          id,
          cwd: rootPath,
          workspaceId,
          workspaceName,
        }).unwrap();
        dispatch(selectTerminal({ key, id: result.session.id }));
      } catch (error) {
        toast.error(
          typeof error === "string" ? error : "Could not create terminal.",
        );
      }
    },
    [create, dispatch, key, rootPath, workspaceId, workspaceName],
  );

  useEffect(() => {
    if (!isOpen) {
      attempted.current = null;
      return;
    }
    if (!query.currentData || query.isFetching || sessions.length > 0 || attempted.current === key)
      return;
    attempted.current = key;
    void addTerminal(true);
  }, [
    isOpen,
    key,
    query.currentData,
    query.isFetching,
    sessions.length,
    addTerminal,
  ]);

  const stopActive = async () => {
    if (!active) return;
    // An explicit stop of the last tab should close the drawer. Idle cleanup
    // from an earlier hide can also empty the catalog after the drawer reopens.
    if (sessions.length === 1) attempted.current = key;
    try {
      await stop(active.id).unwrap();
      dispatch(forgetTerminal({ key, id: active.id }));
      if (sessions.length === 1) onHide();
    } catch (error) {
      toast.error(
        typeof error === "string" ? error : "Could not stop terminal.",
      );
    }
  };

  if (terminalView && "error" in terminalView) throw terminalView.error;
  const XtermTerminal = terminalView?.module.XtermTerminal;

  return (
    <div
      ref={drawerRef}
      className="relative w-full min-w-0 shrink-0 overflow-clip"
      style={{
        height: isOpen ? BOTTOM_TERMINAL_HEIGHT : "0px",
        transition: reducedMotion ? undefined : `height ${BOTTOM_TERMINAL_ANIM_MS}ms ${BOTTOM_TERMINAL_EASE}`,
      }}
    >
      {displayed && (
        <section
          aria-label="Workspace terminals"
          inert={!isOpen}
          className="absolute inset-x-0 top-1.25 flex flex-col overflow-hidden rounded-2xl bg-primary dark:bg-primary-950"
          style={{ height: BOTTOM_TERMINAL_CONTENT_HEIGHT }}
        >
          <div className="flex min-w-0 items-center gap-2 px-3 pt-2 pb-1">
            <HorizontalFadeScroller
              className="min-w-0 flex-1"
              contentClassName="w-max"
            >
              {displayedActive ? (
                <SegmentedTabs
                className="rounded-[!"
                  id={tabsId}
                  value={displayedActive.id}
                  options={displayed.sessions.map((session) => ({
                    value: session.id,
                    label: (
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={`size-1.5 rounded-full ${(session.servers?.length ?? 0) > 0 ? "bg-success" : "bg-primary-400"}`}
                        />
                        {session.title}
                      </span>
                    ),
                  }))}
                  onChange={(id) => dispatch(selectTerminal({ key, id }))}
                  panelId={panelId}
                  aria-label="Terminal tabs"
                />
              ) : (
                <Text size="s" tone="faint">
                  {creation.isLoading || query.isLoading
                    ? "Starting terminal…"
                    : "No open terminals"}
                </Text>
              )}
            </HorizontalFadeScroller>
            <Button
              variant="icon"
              disabled={creation.isLoading}
              onClick={() => void addTerminal()}
              aria-label="New terminal"
              tooltip="New terminal"
            >
              <Plus className="size-4" />
            </Button>
            {displayedActive && (
              <Button
                variant="icon"
                disabled={stopping.isLoading}
                onClick={() => void stopActive()}
                aria-label={`Stop ${displayedActive.title}`}
                tooltip="Stop terminal and its processes"
              >
                <Trash className="size-3.5" />
              </Button>
            )}
            <Button
              variant="icon"
              onClick={onHide}
              aria-label="Hide terminal"
              tooltip="Hide terminal"
            >
              <Close className="size-4" />
            </Button>
          </div>
          {query.isError && (
            <div className="flex items-center gap-2 px-3 py-1">
              <Text size="s" tone="danger">
                Could not load terminals.
              </Text>
              <Button
                variant="bare"
                onClick={() => void query.refetch()}
                className="text-s text-accent"
              >
                Retry
              </Button>
            </div>
          )}
          {displayedActive && (
            <div
              id={panelId}
              role="tabpanel"
              aria-labelledby={getSegmentedTabId(tabsId, displayedActive.id)}
              className="min-h-0 flex-1 px-3 [contain:layout_paint]"
            >
              {canMountTerminal && XtermTerminal && (
                <XtermTerminal
                  key={`${backendId}-${displayedActive.id}-${displayedActive.instanceId ?? ""}`}
                  id={displayedActive.id}
                  persistent
                />
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
