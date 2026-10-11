import { useNavigate } from "react-router-dom";
import type { TerminalSession } from "@mains/contracts/terminal";
import { Text, toast } from "@/components/ui";
import { Terminal, Trash } from "@/components/ui/icons";
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
  const context = `${session.workspaceName ?? session.workspaceId} · ${session.title}`;

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
      icon={<Terminal className="size-4 text-success" />}
      label={
        <span className="block min-w-0">
          <span className="flex items-center gap-2">
            <span className="shrink-0 tabular-nums">:{server.port}</span>
            <Text as="span" size="inherit" tone="subtle" weight="normal" className="truncate">
              {server.command}
            </Text>
          </span>
          <Text as="span" size="xs" tone="faint" weight="normal" className="block truncate">
            {context}
          </Text>
        </span>
      }
      title={`Open terminal: ${context}`}
      onClick={openTerminal}
      trailing={<Terminal aria-hidden className="size-3.5" />}
      hoverAction={{
        icon: <Trash className="size-3.5" />,
        title: `Stop terminal and its servers: ${context}`,
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
