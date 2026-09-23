import { useState } from "react";
import { Button, Text } from "@/components/ui";
import { Download, Lock } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import {
  getProviderVariant,
  type ProviderVariant,
} from "@/lib/provider-variants";
import { useProviderAuthTerminal } from "@/features/workspace/hooks/use-provider-auth-terminal";
import { useUpdateProviderCliMutation } from "@/lib/redux/api";

/**
 * The shell both notices share: the composer's own glass surface, so an app
 * theme re-tints it along with everything around it. The warning lives in the
 * icon alone — the fixed status color painted across the whole row turned into
 * a muddy block on every themed surface.
 */
function NoticeShell({
  icon,
  title,
  message,
  actions,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  message?: string | null;
  actions: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-2 flex items-center justify-between gap-3 rounded-2xl glass-surface px-3 py-2.5 text-xs",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="min-w-0">
          <Text as="span" size="inherit" tone="default" weight="medium">
            {title}
          </Text>
          {message ? (
            <Text as="span" size="inherit" tone="subtle">
              {" "}
              — {message}
            </Text>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">{actions}</span>
    </div>
  );
}

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
 * Auth notice with a one-click recovery: "Sign in" opens a scoped
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
  className,
}: ProviderAuthNoticeProps) {
  const authTerminal = useProviderAuthTerminal();
  const { providerId, authLoginCommand } = getProviderVariant(variant);

  return (
    <NoticeShell
      icon={<Lock className="size-4 shrink-0 text-warning" />}
      title={title}
      message={message}
      className={className}
      actions={
        <>
          {onRecheck && (
            <Button variant="ghost" onClick={onRecheck} isLoading={isRechecking}>
              Check Auth
            </Button>
          )}
          <Button
            variant="primary"
            tooltip={`Runs \`${authLoginCommand}\` in the terminal`}
            tooltipPosition="top-left"
            onClick={() => authTerminal.open(providerId, authLoginCommand)}
          >
            Sign in
          </Button>
        </>
      }
    />
  );
}

/**
 * Same shell for an unsupported (too-old) provider CLI. Signing in can't fix
 * a version gate, so callers render this *instead of* the auth notice;
 * recovery is `providers:updateCli` rather than a login shell.
 */
export function ProviderCliUpdateNotice({
  providerId,
  message,
  onUpdated,
  className,
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
    <NoticeShell
      icon={<Download className="size-4 shrink-0 text-warning" />}
      title="Update required"
      message={failure ?? message}
      className={className}
      actions={
        <Button variant="primary" onClick={handleUpdate} isLoading={isUpdating}>
          Update CLI
        </Button>
      }
    />
  );
}
