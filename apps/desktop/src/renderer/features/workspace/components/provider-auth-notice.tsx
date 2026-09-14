import { useState } from "react";
import { Button, Text } from "@/components/ui";
import {
  getProviderVariant,
  type ProviderVariant,
} from "@/lib/provider-variants";
import { useProviderAuthTerminal } from "@/features/workspace/hooks/use-provider-auth-terminal";
import { useUpdateProviderCliMutation } from "@/lib/redux/api";

interface ProviderAuthNoticeProps {
  variant: ProviderVariant;
  title: string;
  message?: string | null;
  /** Optional re-probe action (e.g. refetch models + account info). */
  onRecheck?: () => void;
  isRechecking?: boolean;
  className?: string;
}

/**
 * Yellow auth notice with a one-click recovery: "Sign in" opens a scoped
 * provider-auth terminal and runs the variant's `authLoginCommand` (the login
 * flows are interactive, so they live in a PTY rather than a headless spawn).
 * Used above the composer (signed-out preflight) and in the transcript when
 * a run fails with an auth-classified error.
 */
export function ProviderAuthNotice({
  variant,
  title,
  message,
  onRecheck,
  isRechecking = false,
  className = "",
}: ProviderAuthNoticeProps) {
  const authTerminal = useProviderAuthTerminal();
  const { providerId, authLoginCommand } = getProviderVariant(variant);

  return (
    <div
      className={`px-3 py-2.5 mb-2 rounded-2xl text-warning bg-warning/10 dark:bg-warning/10 text-xs flex items-center justify-between gap-3 ${className}`}
    >
      <span className="min-w-0">
        <Text as="span" size="inherit" tone="inherit" weight="medium">{title}</Text>
        {message ? <span className="opacity-80"> — {message}</span> : null}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {onRecheck && (
          <Button
            type="button"
            variant="subtle"
            onClick={onRecheck}
            isLoading={isRechecking}
            className=" glass-outline text-warning hover:text-warning/80 hover:bg-warning/10! transition-colors cursor-pointer"
          >
            Check Auth
          </Button>
        )}
        <Button
          type="button"
          variant="subtle"
          tooltip={`Runs \`${authLoginCommand}\` in the terminal`}
          tooltipPosition="top-left"
          onClick={() => authTerminal.open(providerId, authLoginCommand)}
          className=" glass-outline bg-warning/10 text-warning hover:text-warning/80 hover:bg-warning/20! transition-colors cursor-pointer"
        >
          Sign in
        </Button>
      </span>
    </div>
  );
}

/**
 * Same warning shell for an unsupported (too-old) provider CLI. Signing in
 * can't fix a version gate, so callers render this *instead of* the auth
 * notice; recovery is `providers:updateCli` rather than a login shell.
 */
export function ProviderCliUpdateNotice({
  providerId,
  message,
  onUpdated,
  className = "",
}: {
  providerId: string;
  message: string;
  /** Called after a successful update so the caller can re-probe models/auth. */
  onUpdated?: () => void;
  className?: string;
}) {
  const [updateCli, { isLoading: isUpdating }] = useUpdateProviderCliMutation();
  const [failure, setFailure] = useState<string | null>(null);

  const handleUpdate = async () => {
    setFailure(null);
    try {
      const res = await updateCli(providerId).unwrap();
      if (res.success) {
        onUpdated?.();
      } else {
        setFailure(res.output || "Update failed.");
      }
    } catch {
      setFailure("Update failed.");
    }
  };

  return (
    <div
      className={`px-3 py-2.5 mb-2 rounded-2xl text-warning bg-warning/10 dark:bg-warning/10 text-xs flex items-center justify-between gap-3 ${className}`}
    >
      <span className="min-w-0">
        <Text as="span" size="inherit" tone="inherit" weight="medium">Update required</Text>
        <span className="opacity-80"> — {failure ?? message}</span>
      </span>
      <Button
        type="button"
        variant="subtle"
        onClick={handleUpdate}
        isLoading={isUpdating}
        className=" glass-outline bg-warning/10 text-warning hover:text-warning/80 hover:bg-warning/20! transition-colors cursor-pointer shrink-0"
      >
        Update CLI
      </Button>
    </div>
  );
}
