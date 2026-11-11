import { useEffect, type ComponentProps } from "react";
import { PermissionModeDropdown } from "@/components/ui";
import { useGetCodexPermissionsQuery } from "@/lib/redux/api/providersApi";
import { codexPermissionOptions, codexPermissionLabels } from "@/lib/codex-permission-options";
import { getProviderVariant, type ProviderVariant } from "@/lib/provider-variants";

export function ComposerPermissionDropdown({ workspacePath, variant, ...props }: ComponentProps<typeof PermissionModeDropdown> & {
  variant: ProviderVariant; workspacePath?: string;
}) {
  const id = getProviderVariant(variant).providerId;
  const query = useGetCodexPermissionsQuery({ id, workspacePath }, { skip: variant !== "codex", refetchOnMountOrArgChange: true });
  const { refetch } = query;
  useEffect(() => { if (variant === "codex" && props.isOpen) void refetch(); }, [variant, props.isOpen, refetch]);
  const modes = variant === "codex" ? codexPermissionOptions(query.currentData, !!query.error, props.permissionMode) : undefined;
  return <PermissionModeDropdown {...props} variant={variant} modes={modes}
    modeLabels={modes ? codexPermissionLabels(modes) : undefined} />;
}
