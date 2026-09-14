import { useCallback, useEffect, useState } from "react";
import { nanoid } from "@reduxjs/toolkit";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  addBackend,
  markConnected,
  removeBackend,
  renameBackend,
  setActiveBackend,
  type BackendSshConfig,
} from "@/lib/redux/slices/backendsSlice";
import {
  connectRemoteBackend,
  disconnectRemoteBackend,
  getTransport,
  onTransportChange,
  type TransportStatus,
} from "@/lib/transport";

/**
 * The SSH tunnel backing the active remote backend, if any. Module-level so
 * connect/disconnect share it across the app (one active backend at a time).
 */
let activeTunnelId: string | null = null;

/**
 * Track the active transport's connection status, re-subscribing when the
 * transport is swapped (local ↔ remote). Local IPC is always `"connected"`.
 */
export function useTransportStatus(): TransportStatus {
  const [status, setStatus] = useState<TransportStatus>(() =>
    getTransport().status(),
  );

  useEffect(() => {
    let offStatus = () => {};
    const bind = () => {
      offStatus();
      const transport = getTransport();
      setStatus(transport.status());
      offStatus = transport.onStatusChange(setStatus);
    };
    bind();
    const offChange = onTransportChange(bind);
    return () => {
      offStatus();
      offChange();
    };
  }, []);

  return status;
}

/**
 * Backend registry + connection control for the settings UI. Ties the persisted
 * {@link KnownBackend} list to the transport: connecting points the whole UI
 * (RTK Query, appApi, appEvents) at the remote backend; disconnecting returns to
 * the local in-process backend. See docs/design/remote-backend.md (Phase 4).
 */
export function useBackendConnection() {
  const dispatch = useAppDispatch();
  const saved = useAppSelector((s) => s.backends.saved);
  const activeBackendId = useAppSelector((s) => s.backends.activeBackendId);
  const status = useTransportStatus();

  const connect = useCallback(
    async (id: string) => {
      const backend = saved.find((b) => b.id === id);
      if (!backend) return;
      let url: string | undefined;
      let token: string | undefined;
      if (backend.ssh) {
        // Open an SSH tunnel locally and connect to the forwarded loopback port.
        const res = await window.api.ssh.openTunnel(backend.ssh);
        if (!res.success) throw new Error(res.error);
        activeTunnelId = res.data.id;
        url = res.data.localUrl;
        token = res.data.token ?? undefined; // ephemeral token (auto-launch case)
      } else {
        url = backend.wsUrl;
      }
      // Fall back to the stored pairing token (direct mode, or SSH to a
      // pre-running token-protected backend).
      if (!token && backend.hasToken) {
        const stored = await window.api.remoteBackends.getToken(id);
        if (stored.success && stored.data) token = stored.data;
      }
      if (!url) throw new Error("Backend has no address");
      connectRemoteBackend(url, token ? { token } : undefined);
      dispatch(setActiveBackend(id));
      dispatch(markConnected({ id, at: Date.now() }));
    },
    [saved, dispatch],
  );

  const disconnect = useCallback(async () => {
    disconnectRemoteBackend();
    dispatch(setActiveBackend(null));
    if (activeTunnelId) {
      const tunnelId = activeTunnelId;
      activeTunnelId = null;
      await window.api.ssh.closeTunnel(tunnelId);
    }
  }, [dispatch]);

  const add = useCallback(
    async (input: {
      label: string;
      wsUrl?: string;
      ssh?: BackendSshConfig;
      token?: string;
    }) => {
      const id = nanoid();
      if (input.token) await window.api.remoteBackends.setToken(id, input.token);
      dispatch(
        addBackend({
          id,
          label: input.label,
          wsUrl: input.wsUrl,
          ssh: input.ssh,
          hasToken: !!input.token,
        }),
      );
    },
    [dispatch],
  );

  const remove = useCallback(
    (id: string) => {
      if (id === activeBackendId) void disconnect();
      const backend = saved.find((b) => b.id === id);
      if (backend?.hasToken) void window.api.remoteBackends.deleteToken(id);
      dispatch(removeBackend(id));
    },
    [dispatch, activeBackendId, disconnect, saved],
  );

  const rename = useCallback(
    (id: string, label: string) => {
      dispatch(renameBackend({ id, label }));
    },
    [dispatch],
  );

  return {
    saved,
    activeBackendId,
    /** Connection status of the active transport (only meaningful while remote). */
    status,
    /** True when a remote backend is active. */
    isRemote: activeBackendId !== null,
    connect,
    disconnect,
    add,
    remove,
    rename,
  };
}
