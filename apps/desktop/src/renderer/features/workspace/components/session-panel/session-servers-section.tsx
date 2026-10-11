import { useNavigate } from "react-router-dom";
import type { TerminalSession } from "@mains/contracts/terminal";
import { Text, toast } from "@/components/ui";
import { ArrowUp, Trash } from "@/components/ui/icons";
import { useStopTerminalMutation } from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setBottomTerminalOpen } from "@/lib/redux/slices/appSettingsSlice";
import {
  forgetTerminal,
  selectTerminal,
  terminalWorkspaceKey,
} from "@/lib/redux/slices/terminalSlice";
import { PanelItem } from "./panel-item";

function SessionServerPorts({ session }: { session: TerminalSession }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const backendId = useAppSelector((state) => state.backends.activeBackendId ?? "local");
  const [stop, stopping] = useStopTerminalMutation();
  const workspaceName = session.workspaceName ?? session.workspaceId;

  const openTerminal = () => {
    if (!session.workspaceId) return;
    dispatch(selectTerminal({
      key: terminalWorkspaceKey(backendId, session.workspaceId),
      id: session.id,
    }));
    dispatch(setBottomTerminalOpen(true));
    navigate(`/code/${encodeURIComponent(session.workspaceId)}`);
  };

  const stopTerminal = async () => {
    try {
      await stop(session.id).unwrap();
      if (session.workspaceId) {
        dispatch(forgetTerminal({
          key: terminalWorkspaceKey(backendId, session.workspaceId),
          id: session.id,
        }));
      }
    } catch (error) {
      toast.error(typeof error === "string" ? error : "Could not stop server.");
    }
  };

  return session.servers?.map((server) => (
    <PanelItem
      key={`${server.pid}:${server.port}`}
      icon={
        <span className="flex size-3 items-center justify-center">
          <span className="size-2 rounded-full bg-success" />
        </span>
      }
      label={
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate">{server.command}</span>{" "}
            <span className="shrink-0 tabular-nums">:{server.port}</span>
          </span>{" "}
          <Text as="span" size="xs" tone="subtle" weight="normal" className="max-w-[40%] shrink-0 truncate">
            {workspaceName}
          </Text>
        </span>
      }
      title={`Open terminal: ${workspaceName}`}
      onClick={openTerminal}
      trailing={<ArrowUp aria-hidden className="size-3.5 rotate-90" />}
      hoverAction={{
        icon: <Trash className="size-3.5" />,
        title: `Stop terminal and its servers: ${workspaceName}`,
        onClick: () => void stopTerminal(),
        pending: stopping.isLoading,
      }}
    />
  ));
}

/** Verified listeners from managed terminals, including background workspaces. */
export function SessionServersSection({
  sessions,
  separated,
}: {
  sessions: TerminalSession[];
  separated: boolean;
}) {
  const count = sessions.reduce((total, session) => total + (session.servers?.length ?? 0), 0);
  return (
    <section
      aria-labelledby="session-servers-heading"
      className={separated ? "mt-1 border-t border-primary-200/70 pt-1 dark:border-primary-800/70" : undefined}
    >
      <div className="flex items-center justify-between px-2 pb-1 pt-2">
        <Text id="session-servers-heading" as="h2" size="xs" tone="subtle" weight="medium">
          Running servers
        </Text>
        <Text as="span" size="xs" tone="faint" className="tabular-nums">
          {count}
        </Text>
      </div>
      {sessions.map((session) => <SessionServerPorts key={session.id} session={session} />)}
    </section>
  );
}
