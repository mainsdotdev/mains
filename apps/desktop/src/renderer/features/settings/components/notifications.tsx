import { Toggle } from "@/components/ui";
import {
  useGetAppSettingsQuery,
  useSetNotifyOnRunCompleteMutation,
  useSetNotifyOnToolApprovalMutation,
} from "@/lib/redux/api";
import {
  SettingsDivider,
  SettingsPageShell,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";

function NotifyRunCompleteToggle() {
  const { data: settings } = useGetAppSettingsQuery();
  const [setNotifyOnRunComplete] = useSetNotifyOnRunCompleteMutation();

  return (
    <Toggle
      enabled={settings?.notifyOnRunComplete ?? true}
      aria-label="Notify when runs complete"
      onChange={(enabled) => setNotifyOnRunComplete(enabled)}
    />
  );
}

function NotifyToolApprovalToggle() {
  const { data: settings } = useGetAppSettingsQuery();
  const [setNotifyOnToolApproval] = useSetNotifyOnToolApprovalMutation();

  return (
    <Toggle
      enabled={settings?.notifyOnToolApproval ?? true}
      aria-label="Notify when a tool needs approval"
      onChange={(enabled) => setNotifyOnToolApproval(enabled)}
    />
  );
}

export default function NotificationsSettings() {
  return (
    <SettingsPageShell title="Notifications">
      <SettingsSection>
        <SettingsRow
          title="Run Complete"
          description="Get notified when a run finishes"
        >
          <NotifyRunCompleteToggle />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Tool Approval"
          description="Get notified when a tool needs your approval"
        >
          <NotifyToolApprovalToggle />
        </SettingsRow>
      </SettingsSection>
    </SettingsPageShell>
  );
}
