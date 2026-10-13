import { lazy, Suspense, useCallback, useEffect, useId, useRef } from "react";
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
import { BOTTOM_TERMINAL_HEIGHT } from "@/lib/layout";

const XtermTerminal = lazy(() =>
  import("./xterm-terminal").then((module) => ({
    default: module.XtermTerminal,
  })),
);

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
  const tabsId = useId();
  const panelId = `${tabsId}-panel`;
  const sessions = (query.currentData ?? []).filter(
    (session) => session.workspaceId === workspaceId,
  );
  const active =
    sessions.find((session) => session.id === selectedId) ?? sessions[0];

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
    if (!query.currentData || query.isFetching || attempted.current === key)
      return;
    attempted.current = key;
    if (sessions.length === 0) void addTerminal(true);
    // A workspace gets one initial terminal. Stopping the last one must not respawn it.
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

  return (
    <div
      className="w-full min-w-0 shrink-0 overflow-hidden transition-[height,padding-top] duration-300 ease-out"
      style={{
        height: isOpen ? BOTTOM_TERMINAL_HEIGHT : "0px",
        paddingTop: isOpen ? "0.3125rem" : "0px",
      }}
    >
      {isOpen && (
        <section
          aria-label="Workspace terminals"
          className="flex h-full flex-col overflow-hidden rounded-2xl bg-primary dark:bg-primary-950"
        >
          <div className="flex min-w-0 items-center gap-2 px-3 pt-2 pb-1">
            <HorizontalFadeScroller
              className="min-w-0 flex-1"
              contentClassName="w-max"
            >
              {active ? (
                <SegmentedTabs
                className="rounded-[!"
                  id={tabsId}
                  value={active.id}
                  options={sessions.map((session) => ({
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
            {active && (
              <Button
                variant="icon"
                disabled={stopping.isLoading}
                onClick={() => void stopActive()}
                aria-label={`Stop ${active.title}`}
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
          {active && (
            <div
              id={panelId}
              role="tabpanel"
              aria-labelledby={getSegmentedTabId(tabsId, active.id)}
              className="min-h-0 flex-1 px-3"
            >
              <Suspense fallback={null}>
                <XtermTerminal
                  key={`${backendId}-${active.id}`}
                  id={active.id}
                  persistent
                />
              </Suspense>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
