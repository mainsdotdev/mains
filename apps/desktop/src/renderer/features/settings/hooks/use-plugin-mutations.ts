import { useCallback, useLayoutEffect, useReducer, useState } from "react";
import { createPluginMutationLifecycle, type PluginMutation } from "@mains/backend/shared/plugin-mutation-lifecycle";
import { toast } from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import {
  useInstallProviderPluginMutation, useUninstallProviderPluginMutation,
  useSetProviderPluginEnabledMutation, useUpdateProviderPluginMutation,
} from "@/lib/redux/api";
import { getTransport, onTransportChange } from "@/lib/transport/registry";

type Owner = { providerId: string; lifecycle: ReturnType<typeof createPluginMutationLifecycle> };

export function usePluginMutations(providerId: string) {
  const [install] = useInstallProviderPluginMutation();
  const [uninstall] = useUninstallProviderPluginMutation();
  const [setEnabled] = useSetProviderPluginEnabledMutation();
  const [update] = useUpdateProviderPluginMutation();
  const [owner, setOwner] = useState<Owner | null>(null);
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  useLayoutEffect(() => {
    let lifecycle: Owner["lifecycle"] | undefined;
    const bind = () => {
      lifecycle?.retire();
      const transport = getTransport();
      lifecycle = createPluginMutationLifecycle({
        isCurrent: () => getTransport() === transport,
        changed: refresh,
        settled(request, outcome) {
          if (outcome.status === "failed") {
            const action = request.type === "install" ? "install" : request.type === "uninstall" ? "uninstall" : "update";
            toast.error(extractErrorMessage(outcome.error, `Failed to ${action} plugin`));
          } else {
            const action = request.type === "install" ? "installed" : request.type === "uninstall" ? "uninstalled"
              : request.type === "update" ? "updated" : request.enabled ? "enabled" : "disabled";
            toast.success(`Plugin ${action}`);
          }
        },
      });
      setOwner({ providerId, lifecycle });
    };
    bind();
    const off = onTransportChange(bind);
    return () => { off(); lifecycle?.retire(); };
  }, [providerId, install, uninstall, setEnabled, update]);

  const lifecycle = owner?.providerId === providerId ? owner.lifecycle : undefined;
  const perform = useCallback(async (request: PluginMutation) => {
    if (!lifecycle?.active || lifecycle.pending(request.pluginId)) return;
    await lifecycle.run(request, (captured) => {
      const input = { providerId, pluginId: captured.pluginId };
      switch (captured.type) {
        case "install": return install({ ...input, scope: captured.scope }).unwrap();
        case "uninstall": return uninstall(input).unwrap();
        case "setEnabled": return setEnabled({ ...input, enabled: captured.enabled }).unwrap();
        case "update": return update(input).unwrap();
      }
    }).catch(() => {}); // The owner reports only its own current result.
  }, [lifecycle, providerId, install, uninstall, setEnabled, update]);
  return { perform, pending: (pluginId: string) => lifecycle?.pending(pluginId) };
}
