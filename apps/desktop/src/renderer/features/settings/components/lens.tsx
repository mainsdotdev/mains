import { useCallback, useEffect, useState } from "react";
import { Button, Select, Text, Toggle, toast } from "@/components/ui";
import { Check } from "@/components/ui/icons";
import {
  SettingsDivider,
  SettingsPageShell,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";
import {
  APPSHOT_SHORTCUTS,
  type AppshotShortcut,
  type AppshotsConfiguration,
  type AppshotsStatus,
  type AppshotsSystemSettingsPane,
} from "../../../../shared/appshots";
import type { ServiceResponse } from "../../../../shared/ipc-kit/service-response";

const SHORTCUT_OPTIONS = APPSHOT_SHORTCUTS.map((value) => ({
  value,
  label:
    value === "Command+Shift+Space"
      ? "⌘ ⇧ Space"
      : value === "Command+Shift+A"
        ? "⌘ ⇧ A"
        : "⌘ ⌥ Space",
}));

function PermissionStatus({ granted }: { granted: boolean }) {
  return (
    <Text
      as="span"
      size="xs"
      weight="medium"
      tone={granted ? "success" : "subtle"}
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      aria-live="polite"
    >
      {granted ? (
        <span
          className="flex size-4 items-center justify-center rounded-full bg-success text-white"
          aria-hidden="true"
        >
          <Check className="size-2.5" />
        </span>
      ) : (
        <span
          className="size-2 rounded-full bg-primary-400 dark:bg-primary-500"
          aria-hidden="true"
        />
      )}
      {granted ? "Granted" : "Not granted"}
    </Text>
  );
}

export default function LensSettings() {
  const [status, setStatus] = useState<AppshotsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const applyStatus = useCallback((response: ServiceResponse<AppshotsStatus>) => {
    if (response.success) {
      setStatus(response.data);
      setLoadError(null);
      return true;
    }
    setLoadError(response.error);
    return false;
  }, []);

  const loadStatus = useCallback(async () => {
    const response = (await window.api.appshots.getStatus()) as ServiceResponse<AppshotsStatus>;
    applyStatus(response);
  }, [applyStatus]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void window.api.appshots.getStatus().then(
        (response: ServiceResponse<AppshotsStatus>) => {
          if (cancelled) return;
          applyStatus(response);
          setIsLoading(false);
        },
        (error: unknown) => {
          if (cancelled) return;
          setLoadError(error instanceof Error ? error.message : String(error));
          setIsLoading(false);
        },
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [applyStatus]);

  const configure = async (configuration: AppshotsConfiguration) => {
    setBusy(true);
    try {
      const response = (await window.api.appshots.configure(
        configuration,
      )) as ServiceResponse<AppshotsStatus>;
      applyStatus(response);
      if (!response.success) {
        toast.error(response.error);
        await loadStatus();
      }
    } finally {
      setBusy(false);
    }
  };

  const captureWindow = async () => {
    setBusy(true);
    try {
      const response = (await window.api.appshots.captureNow()) as ServiceResponse<unknown>;
      if (!response.success) toast.error(response.error);
    } finally {
      setBusy(false);
    }
  };

  const requestAccessibility = async () => {
    const response = (await window.api.appshots.requestAccessibility()) as ServiceResponse<AppshotsStatus>;
    if (response.success) setStatus(response.data);
    else toast.error(response.error);
  };

  const openSystemSettings = async (pane: AppshotsSystemSettingsPane) => {
    const response = (await window.api.appshots.openSystemSettings(
      pane,
    )) as ServiceResponse<null>;
    if (!response.success) toast.error(response.error);
  };

  const supported = status?.supported === true;
  const enabled = supported ? status.enabled : false;
  const shortcut = status?.shortcut ?? APPSHOT_SHORTCUTS[0];
  const registrationProblem =
    supported && status.enabled && !status.shortcutRegistered
      ? status.lastError || "This shortcut is unavailable"
      : null;

  return (
    <SettingsPageShell
      title="Lens"
      isLoading={isLoading}
      error={loadError}
      errorMessage={loadError ?? undefined}
    >
      <SettingsSection title="Capture">
        <SettingsRow
          title="Window Capture"
          description={
            status && !supported
              ? "Lens is currently available on macOS only"
              : "Capture the frontmost window into your next message. Nothing is sent until you send the message."
          }
        >
          <Toggle
            enabled={enabled}
            disabled={!supported || busy}
            aria-label="Enable Lens window capture"
            onChange={(next) => void configure({ enabled: next, shortcut })}
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Keyboard Shortcut"
          description={
            registrationProblem ? (
              <Text as="span" size="xs" tone="danger">
                {registrationProblem}
              </Text>
            ) : (
              "Works globally while Mains is running"
            )
          }
        >
          <Select<AppshotShortcut>
            value={shortcut}
            options={SHORTCUT_OPTIONS}
            aria-label="Lens keyboard shortcut"
            disabled={!supported || busy || !enabled}
            onChange={(next) => void configure({ enabled, shortcut: next })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Permissions">
        <SettingsRow
          title="Screen Recording"
          description="Required to capture the pixels of the selected window. macOS may require an app restart after granting access."
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:justify-end">
            <PermissionStatus
              granted={status?.screenPermission === "granted"}
            />
            <Button
              type="button"
              variant="ghost"
              disabled={!supported}
              onClick={() => void openSystemSettings("screen-recording")}
            >
              {status?.screenPermission === "granted"
                ? "Open Settings"
                : "Grant Access"}
            </Button>
          </div>
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Accessibility"
          description="Optional; adds readable interface text so agents can understand the capture more precisely."
        >
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <PermissionStatus granted={status?.accessibilityTrusted === true} />
            <Button
              type="button"
              variant="ghost"
              disabled={!supported}
              onClick={() => void openSystemSettings("accessibility")}
            >
              Accessibility
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!supported}
              onClick={() => void openSystemSettings("automation")}
            >
              Automation
            </Button>
            {!status?.accessibilityTrusted && (
              <Button
                type="button"
                variant="primary"
                disabled={!supported}
                onClick={() => void requestAccessibility()}
              >
                Request Access
              </Button>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Test">
        <SettingsRow
          title="Capture Window"
          description="Capture the currently frontmost Mains window and add it to the composer"
        >
          <Button
            type="button"
            variant="primary"
            disabled={!supported}
            isLoading={busy || status?.capturing === true}
            onClick={() => void captureWindow()}
          >
            Capture Window
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsPageShell>
  );
}
