import { useEffect, useLayoutEffect, useRef } from "react";
import { providersApi, useLazyGetProviderPluginsQuery } from "@/lib/redux/api/providersApi";
import { useAppDispatch } from "@/lib/redux/hooks";
import { getTransport, onTransportChange } from "@/lib/transport/registry";
import type { Transport } from "@/lib/transport/types";

const readers = new WeakMap<ReturnType<typeof useAppDispatch>, Map<string, Map<Transport, Set<object>>>>();

function retainReader(dispatch: ReturnType<typeof useAppDispatch>, providerId: string, transport: Transport) {
  let providers = readers.get(dispatch);
  if (!providers) readers.set(dispatch, providers = new Map());
  let transports = providers.get(providerId);
  if (!transports) providers.set(providerId, transports = new Map());
  let owners = transports.get(transport);
  if (!owners) transports.set(transport, owners = new Set());
  const owner = {};
  owners.add(owner);
  return () => {
    if (!owners.delete(owner) || owners.size) return false;
    transports.delete(transport);
    if (!transports.size) providers.delete(providerId);
    if (!providers.size) readers.delete(dispatch);
    return true;
  };
}

function isCancelled(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/** The catalog belongs to its visible page, including refetches after mutations. */
export function usePluginCatalog(providerId: string) {
  const dispatch = useAppDispatch();
  const retry = useRef<(() => void) | undefined>(undefined);
  const [load, result] = useLazyGetProviderPluginsQuery({
    refetchOnFocus: false, refetchOnReconnect: false,
  });
  useLayoutEffect(() => {
    let stop = () => {};
    const bind = (preferCache: boolean) => {
      stop();
      let active = true;
      const release = retainReader(dispatch, providerId, getTransport());
      let request: ReturnType<typeof load> | undefined;
      // Abort rejection reaches Redux asynchronously. Join that settlement
      // before replay/reconnection so RTK does not deduplicate against it.
      const start = (useCache: boolean) => {
        const previous = dispatch(providersApi.util.getRunningQueryThunk("getProviderPlugins", providerId));
        const run = () => {
          if (!active) return;
          const failed = dispatch((_dispatch, getState) =>
            providersApi.endpoints.getProviderPlugins.select(providerId)(getState()).isError);
          request = load(providerId, useCache && !failed);
        };
        if (previous) void previous.then(run); else run();
      };
      const restart = () => start(false);
      retry.current = restart;
      start(preferCache);
      stop = () => {
        if (!active) return;
        active = false;
        if (retry.current === restart) retry.current = undefined;
        if (release()) dispatch(providersApi.util.getRunningQueryThunk("getProviderPlugins", providerId))?.abort();
        request?.unsubscribe();
      };
    };
    bind(true);
    const off = onTransportChange(() => bind(false));
    return () => { off(); stop(); };
  }, [dispatch, load, providerId]);

  // Cancellation belongs to an old lifetime, never to a visible page's error
  // state. Join its rejected thunk before retrying, without retrying real errors.
  const cancelled = isCancelled(result.error);
  useEffect(() => {
    if (!cancelled) return;
    let active = true;
    const restart = retry.current;
    const pending = dispatch(providersApi.util.getRunningQueryThunk("getProviderPlugins", providerId));
    void Promise.resolve(pending).then(() => {
      if (active && restart === retry.current) restart?.();
    });
    return () => { active = false; };
  }, [cancelled, dispatch, providerId, result.error]);

  return { ...result, data: result.currentData, error: cancelled ? undefined : result.error,
    isLoading: result.isUninitialized || result.isLoading || (cancelled && !result.currentData) };
}
