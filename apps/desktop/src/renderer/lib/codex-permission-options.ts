import { codexPermissionChoices, CODEX_BUILTIN_PERMISSION_PROFILES, type CodexPermissionCatalog } from "@mains/contracts/codex-permissions";
import { CODEX_SANDBOX_MODES } from "@/lib/provider-modes";

export function codexPermissionOptions(catalog?: CodexPermissionCatalog, error?: boolean, currentValue?: string) {
  return codexPermissionChoices(catalog, currentValue).map((choice) => {
    const builtin = CODEX_SANDBOX_MODES.find((mode) => mode.value === choice.sandboxMode);
    return { value: choice.value, label: builtin?.label ?? choice.profileId ?? choice.value,
      description: choice.description ?? builtin?.description ?? "Named Codex permission profile",
      disabledReason: error ? "Could not load Codex permissions. Reopen to retry." : catalog
        ? choice.disabledReason : "Loading Codex permissions…",
    };
  });
}

export function codexPermissionLabels(options: ReturnType<typeof codexPermissionOptions>) {
  return { ...Object.fromEntries(CODEX_SANDBOX_MODES.flatMap((mode) => [
    [mode.value, mode.label], [`profile:${CODEX_BUILTIN_PERMISSION_PROFILES[mode.value]}`, mode.label],
  ])), ...Object.fromEntries(options.map((option) => [option.value, option.label])) };
}
