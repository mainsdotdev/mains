import { useEffect, useState } from "react";
import {
  Body,
  Button,
  Caption,
  Input,
  Muted,
  SegmentedTabs,
  Text,
  toast,
} from "@/components/ui";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsDivider,
} from "@/features/settings/components/settings-layout";
import { useBackendConnection } from "../hooks/use-backend-connection";
import { isWeb } from "@/lib/platform";
import {
  LocalBackendShare,
  RemoteKeepAwakeSetting,
} from "./local-backend-share";
import type {
  BackendSshConfig,
  KnownBackend,
} from "@/lib/redux/slices/backendsSlice";
import type { TransportStatus } from "@/lib/transport";

const WS_URL_RE = /^wss?:\/\/.+/i;
const DEFAULT_REMOTE_PORT = 8787;
const ADD_BACKEND_MODE_OPTIONS = [
  { value: "direct", label: "Direct URL" },
  { value: "ssh", label: "SSH tunnel" },
] as const;

const STATUS_LABEL: Record<TransportStatus, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

function StatusDot({ status }: { status: TransportStatus }) {
  const color =
    status === "connected"
      ? "bg-success"
      : status === "connecting" || status === "reconnecting"
        ? "bg-warning"
        : "bg-danger";
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color}`}
      aria-label={STATUS_LABEL[status]}
    />
  );
}

type AddInput = {
  label: string;
  wsUrl?: string;
  ssh?: BackendSshConfig;
  token?: string;
};

function AddBackendForm({
  onAdd,
}: {
  onAdd: (input: AddInput) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"direct" | "ssh">("direct");
  const [label, setLabel] = useState("");
  const [wsUrl, setWsUrl] = useState("");
  const [host, setHost] = useState("");
  const [remotePort, setRemotePort] = useState(String(DEFAULT_REMOTE_PORT));
  const [remoteCommand, setRemoteCommand] = useState("");
  const [token, setToken] = useState("");
  const [detected, setDetected] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.api.ssh
      .discoverHosts()
      .then((res: { success: boolean; data?: { alias: string }[] }) => {
        if (!cancelled && res.success && res.data) {
          setDetected(res.data.map((h) => h.alias));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const reset = () => {
    setLabel("");
    setWsUrl("");
    setHost("");
    setRemotePort(String(DEFAULT_REMOTE_PORT));
    setRemoteCommand("");
    setToken("");
  };

  const submit = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      toast.error("Enter a name for the backend.");
      return;
    }
    const tokenValue = token.trim() || undefined;
    let input: AddInput;
    if (mode === "direct") {
      const url = wsUrl.trim();
      if (!WS_URL_RE.test(url)) {
        toast.error("Enter a valid WebSocket URL (ws:// or wss://).");
        return;
      }
      input = { label: trimmedLabel, wsUrl: url, token: tokenValue };
    } else {
      const trimmedHost = host.trim();
      const port = Number(remotePort);
      if (!trimmedHost) {
        toast.error("Enter an SSH host.");
        return;
      }
      if (!Number.isInteger(port) || port <= 0) {
        toast.error("Enter a valid remote port.");
        return;
      }
      input = {
        label: trimmedLabel,
        ssh: {
          host: trimmedHost,
          remotePort: port,
          remoteCommand: remoteCommand.trim() || undefined,
        },
        token: tokenValue,
      };
    }
    try {
      await onAdd(input);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add backend.",
      );
      return;
    }
    reset();
    toast.success(`Added "${trimmedLabel}".`);
  };

  return (
    <div className="py-3 space-y-2">
      <SegmentedTabs
        value={mode}
        onChange={setMode}
        options={ADD_BACKEND_MODE_OPTIONS}
        semantics="radiogroup"
        aria-label="Backend connection method"
        className="w-fit"
      />

      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name (e.g. Dev box)"
      />

      {mode === "direct" ? (
        <Input
          value={wsUrl}
          onChange={(e) => setWsUrl(e.target.value)}
          placeholder="ws://127.0.0.1:8787"
        />
      ) : (
        <div className="space-y-2">
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="SSH host (alias or user@host)"
          />
          <Input
            value={remotePort}
            onChange={(e) => setRemotePort(e.target.value)}
            placeholder="Remote port (e.g. 8787)"
          />
          <Input
            value={remoteCommand}
            onChange={(e) => setRemoteCommand(e.target.value)}
            placeholder="Optional launch command (e.g. mains serve --port 8787)"
          />
          {detected.length > 0 && (
            <div className="pt-1">
              <Caption className="mb-1.5 block">
                Detected hosts (SSH config + known hosts)
              </Caption>
              <div className="max-h-44 overflow-auto noscrollbar rounded-xl border border-primary-200/60 dark:border-primary-800/30 divide-y divide-primary-200/40 dark:divide-primary-800/20">
                {detected.map((alias) => (
                  <div
                    key={alias}
                    className="flex items-center justify-between gap-2 px-3 py-1.5"
                  >
                    <Text as="span" className="truncate">
                      {alias}
                    </Text>
                    <Button
                      type="button"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => setHost(alias)}
                    >
                      Add host
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Input
        value={token}
        type="password"
        autoComplete="off"
        onChange={(e) => setToken(e.target.value)}
        placeholder="Owner token"
      />
      <Caption>
        {mode === "ssh"
          ? "Leave blank when a launch command is set — a token is generated automatically. Otherwise paste the one `mains` printed."
          : "Printed by `mains`, or shown under This machine."}
      </Caption>

      <div className="flex justify-end">
        <Button type="button" variant="submit" onClick={() => void submit()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function backendSubtitle(backend: KnownBackend): string {
  if (backend.ssh) {
    return `ssh · ${backend.ssh.host}:${backend.ssh.remotePort}`;
  }
  return backend.wsUrl ?? "";
}

function BackendRow({
  backend,
  isActive,
  status,
  connecting,
  controlsDisabled,
  onConnect,
  onDisconnect,
  onRename,
  onRemove,
}: {
  backend: KnownBackend;
  isActive: boolean;
  status: TransportStatus;
  connecting: boolean;
  controlsDisabled: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRename: (label: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(backend.label);

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== backend.label) onRename(next);
    setEditing(false);
  };

  return (
    <div className="flex items-center justify-between py-3 gap-4">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraft(backend.label);
                setEditing(false);
              }
            }}
            className="w-48"
          />
        ) : (
          <div className="flex items-center gap-2">
            {isActive && <StatusDot status={status} />}
            <Body className="truncate">{backend.label}</Body>
            {isActive && (
              <Caption className="shrink-0">{STATUS_LABEL[status]}</Caption>
            )}
          </div>
        )}
        <Caption className="truncate block">{backendSubtitle(backend)}</Caption>
        {backend.lastDescriptor && (
          <Caption className="truncate block">
            Last verified: {backend.lastDescriptor.name} · Mains v
            {backend.lastDescriptor.appVersion}
          </Caption>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1">
        {isActive ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onDisconnect}
            disabled={controlsDisabled}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={onConnect}
            disabled={controlsDisabled}
            isLoading={connecting}
          >
            Connect
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setEditing(true)}
          disabled={controlsDisabled}
        >
          Rename
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onRemove}
          disabled={controlsDisabled}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

export default function BackendsSettings() {
  const {
    saved,
    activeBackendId,
    status,
    isRemote,
    connect,
    disconnect,
    add,
    remove,
    rename,
  } = useBackendConnection();
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleConnect = async (id: string) => {
    setBusyId(id);
    try {
      const descriptor = await connect(id);
      toast.success(`Connected to ${descriptor.name}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to connect.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnect = async () => {
    setBusyId("__local__");
    try {
      await disconnect();
    } finally {
      setBusyId(null);
    }
  };

  // In the web client you're already connected to the backend that served this
  // page; adding/switching backends is a desktop-app concern.
  if (isWeb) {
    return (
      <SettingsPageShell title="Mains Connect">
        <Muted>
          This web client is connected to the Mains server at{" "}
          <code>{window.location.host}</code>. Add or switch servers from the
          desktop app.
        </Muted>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Mains Connect">
      <Muted className="mb-6 block">
        Run on this machine or connect to Mains running somewhere else. You can
        also make this machine available to your other devices.
      </Muted>

      <LocalBackendShare />

      <SettingsSection title="Run on">
        <div className="flex items-center justify-between py-3 gap-4">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            {!isRemote && <StatusDot status="connected" />}
            <Body>Local (this machine)</Body>
          </div>
          <div className="shrink-0">
            {isRemote ? (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDisconnect}
                disabled={busyId === "__local__"}
              >
                Use local
              </Button>
            ) : (
              <Caption>Active</Caption>
            )}
          </div>
        </div>

        {saved.length > 0 && <SettingsDivider />}

        {saved.map((backend, i) => (
          <div key={backend.id}>
            {i > 0 && <SettingsDivider />}
            <BackendRow
              backend={backend}
              isActive={backend.id === activeBackendId}
              status={status}
              connecting={busyId === backend.id}
              controlsDisabled={busyId !== null}
              onConnect={() => handleConnect(backend.id)}
              onDisconnect={handleDisconnect}
              onRename={(label) => rename(backend.id, label)}
              onRemove={() => remove(backend.id)}
            />
          </div>
        ))}
      </SettingsSection>

      <SettingsSection title="Add a remote backend">
        <AddBackendForm onAdd={add} />
      </SettingsSection>

      <RemoteKeepAwakeSetting />
    </SettingsPageShell>
  );
}
