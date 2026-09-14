import { Heading2, Text, Tiny, Toggle, toast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { ThemePicker } from "@/features/settings/components/theme-picker";
import {
  useGetAppSettingsQuery,
  useSetNotifyOnRunCompleteMutation,
  useSetNotifyOnToolApprovalMutation,
  useSetEnableWorktreesMutation,
  useSetShowMenuBarIconMutation,
} from "@/lib/redux/api";

const CARD =
  "rounded-3xl bg-primary-100/40 p-6  dark:bg-primary-900/20  glass-outline glass-outline-soft";

function PreferenceCard({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(CARD, className)}>
      <Tiny>{label}</Tiny>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PreferenceRow({
  title,
  description,
  enabled,
  onChange,
}: {
  title: string;
  description?: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Text as="span">{title}</Text>
        {description && (
          <Text as="span" size="xs" tone="subtle" className="leading-snug">
            {description}
          </Text>
        )}
      </div>
      <Toggle
        enabled={enabled}
        onChange={onChange}
        aria-label={title}
        className="shrink-0 py-0"
      />
    </div>
  );
}

/**
 * Second onboarding step: theme, notification, and git worktree preferences.
 * Same settings as the Settings screens — writes go through the shared
 * appSettings mutations, so nothing here is onboarding-specific state.
 */
export function PreferencesStep() {
  const { data: appSettings } = useGetAppSettingsQuery();
  const [setNotifyOnRunComplete] = useSetNotifyOnRunCompleteMutation();
  const [setNotifyOnToolApproval] = useSetNotifyOnToolApprovalMutation();
  const [setShowMenuBarIcon] = useSetShowMenuBarIconMutation();
  const [setEnableWorktrees, { isLoading: updatingWorktrees }] =
    useSetEnableWorktreesMutation();

  const notifyOnRunComplete = appSettings?.notifyOnRunComplete ?? true;
  const notifyOnToolApproval = appSettings?.notifyOnToolApproval ?? true;
  const showMenuBarIcon = appSettings?.showMenuBarIcon ?? true;
  const enableWorktrees = appSettings?.enableWorktrees ?? false;

  const handleWorktreeToggle = async (enabled: boolean) => {
    if (updatingWorktrees) return;
    try {
      await setEnableWorktrees(enabled).unwrap();
    } catch (err: any) {
      toast.error(
        extractErrorMessage(err, "Failed to update worktree setting"),
      );
    }
  };

  const handleMenuBarIconToggle = async (visible: boolean) => {
    try {
      await setShowMenuBarIcon(visible).unwrap();
      // Apply to the running tray immediately, same as General settings.
      await window.api.app.setMenuBarIconVisible(visible);
    } catch (err: any) {
      toast.error(
        extractErrorMessage(err, "Failed to update menu bar setting"),
      );
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-12 space-y-2 text-center">
        <Heading2 className="font-mono tracking-tight">Preferences</Heading2>
      </div>

      <div className="space-y-6">
        <PreferenceCard label="Theme">
          <div className="flex justify-center pt-1">
            <ThemePicker size="lg" />
          </div>
        </PreferenceCard>

        <div className="grid items-start gap-6 sm:grid-cols-2">
          <PreferenceCard label="Notifications">
            <PreferenceRow
              title="Run complete"
              description="Notify when an agent run finishes"
              enabled={notifyOnRunComplete}
              onChange={(next) => setNotifyOnRunComplete(next)}
            />
            <PreferenceRow
              title="Tool approval"
              description="Notify when an agent is waiting for a tool approval"
              enabled={notifyOnToolApproval}
              onChange={(next) => setNotifyOnToolApproval(next)}
            />
          </PreferenceCard>

          <PreferenceCard label="App">
            <PreferenceRow
              title="Menu bar icon"
              description="Show the Mains icon in the system menu bar"
              enabled={showMenuBarIcon}
              onChange={handleMenuBarIconToggle}
            />
          </PreferenceCard>
        </div>

        <PreferenceCard label="Git">
          <PreferenceRow
            title="Worktrees"
            description="Work in an isolated copy of your repo, so you can work on multiple tasks at the same time. When disabled, Mains uses the active branch directly."
            enabled={enableWorktrees}
            onChange={handleWorktreeToggle}
          />
        </PreferenceCard>
      </div>
    </div>
  );
}
