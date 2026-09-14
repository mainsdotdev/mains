import { useState } from "react";
import {
  AsciiSpinner,
  Button,
  Select,
  Slider,
  Text,
  Toggle,
  toast,
} from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  setCodeFontSize,
  setInterfaceFontSize,
} from "@/lib/redux/slices/appSettingsSlice";
import {
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
} from "@/lib/appearance-fonts";
import {
  useGetAppSettingsQuery,
  useSetShowToolCallsMutation,
  useSetPreventSleepDuringRunsMutation,
  useSetNotifyOnRunCompleteMutation,
  useSetNotifyOnToolApprovalMutation,
  useSetShowMenuBarIconMutation,
} from "@/lib/redux/api";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsRow,
  SettingsDivider,
} from "./settings-layout";
import { ThemePicker, ThemeSelect, type ThemeValue } from "./theme-picker";
import { useAutoUpdate } from "@/hooks/use-auto-update";
import { useCapabilities, useIsMobile } from "@/lib/platform";
import { Refresh } from "@/components/ui/icons";
import {
  AgentCard,
  AGENT_CHOICES,
} from "./agent-card";
import { useAgentSpaces } from "@/features/onboarding/hooks/use-agent-spaces";

function UpdateButton({
  state,
  onCheck,
  onInstall,
}: {
  state: { status: string; info: any; progress: any; error: string | null };
  onCheck: () => void;
  onInstall: () => void;
}) {
  switch (state.status) {
    case "checking":
      return (
        <Button type="button" variant="ghost" disabled isLoading>
          Checking...
        </Button>
      );
    case "available":
    case "downloading":
      return (
        <Button
          type="button"
          variant="ghost"
          disabled
          className="flex items-center gap-1"
        >
          <AsciiSpinner variant="null" kind="download" />
          Downloading...
        </Button>
      );
    case "downloaded":
      return (
        <Button type="button" variant="submit" onClick={onInstall}>
          Restart &amp; Update
        </Button>
      );
    case "error":
      return (
        <div className="flex items-center gap-3">
          <Text
            as="span"
            size="xs"
            tone="danger"
            align="right"
            className="leading-relaxed line-clamp-2 max-w-48"
          >
            {state.error}
          </Text>
          <Button type="button" variant="ghost" onClick={onCheck}>
            Retry
          </Button>
        </div>
      );
    case "not-available":
      return (
        <div className="flex items-center gap-2">
          <Text as="span" size="xs" tone="subtle">
            Up to date
          </Text>
          <Button type="button" variant="ghost" onClick={onCheck}>
            Check Again
          </Button>
        </div>
      );
    default:
      return (
        <div className="">
          <Button
            className="flex"
            type="button"
            variant="primary"
            onClick={onCheck}
          >
            <Refresh className="w-4 h-4 mr-1" />
            Check for Updates
          </Button>
        </div>
      );
  }
}

const RUN_DETAIL_OPTIONS = [
  {
    value: "steps_with_tool_calls",
    label: "Steps with tool calls",
    description: "Show tool calls with outputs",
  },
  {
    value: "steps",
    label: "Steps",
    description: "Hide tool calls and outputs",
  },
];

function RunDetailSelect() {
  const { data: settings } = useGetAppSettingsQuery();
  const [setShowToolCalls] = useSetShowToolCallsMutation();

  const value =
    settings?.showToolCalls !== false ? "steps_with_tool_calls" : "steps";

  return (
    <Select
      value={value}
      aria-label="Run detail"
      options={RUN_DETAIL_OPTIONS}
      onChange={(val) => {
        setShowToolCalls(val === "steps_with_tool_calls");
      }}
      placeholder="Select detail level"
    />
  );
}

function PreventSleepToggle() {
  const { data: settings } = useGetAppSettingsQuery();
  const [setPreventSleep] = useSetPreventSleepDuringRunsMutation();

  return (
    <Toggle
      enabled={settings?.preventSleepDuringRuns ?? false}
      aria-label="Prevent sleep during runs"
      onChange={(val) => setPreventSleep(val)}
    />
  );
}

function NotifyRunCompleteToggle() {
  const { data: settings } = useGetAppSettingsQuery();
  const [setNotifyOnRunComplete] = useSetNotifyOnRunCompleteMutation();

  return (
    <Toggle
      enabled={settings?.notifyOnRunComplete ?? true}
      aria-label="Notify when runs complete"
      onChange={(val) => setNotifyOnRunComplete(val)}
    />
  );
}

function MenuBarIconToggle() {
  const { data: settings } = useGetAppSettingsQuery();
  const [setShowMenuBarIcon] = useSetShowMenuBarIconMutation();

  return (
    <Toggle
      enabled={settings?.showMenuBarIcon ?? true}
      aria-label="Show menu bar icon"
      onChange={async (val) => {
        await setShowMenuBarIcon(val);
        await window.api.app.setMenuBarIconVisible(val);
      }}
    />
  );
}

function AgentsSection() {
  const { visibleAgentCount, spacesBySlug, toggleAgent } = useAgentSpaces({
    navigateOnSwitch: false,
  });

  return (
    <div className="flex flex-col gap-3 md:flex-row">
      {AGENT_CHOICES.map(({ slug, label, Icon }) => {
        const space = spacesBySlug.get(slug);
        const isSelected = !!space && !space.isArchived;
        const cannotArchiveLast = isSelected && visibleAgentCount <= 1;
        return (
          <AgentCard
            key={slug}
            label={label}
            Icon={Icon}
            isSelected={isSelected}
            disabled={!space || cannotArchiveLast}
            onClick={() => toggleAgent(slug)}
          />
        );
      })}
    </div>
  );
}

function NotifyToolApprovalToggle() {
  const { data: settings } = useGetAppSettingsQuery();
  const [setNotifyOnToolApproval] = useSetNotifyOnToolApprovalMutation();

  return (
    <Toggle
      enabled={settings?.notifyOnToolApproval ?? true}
      aria-label="Notify when a tool needs approval"
      onChange={(val) => setNotifyOnToolApproval(val)}
    />
  );
}

/**
 * Applied on release, not while dragging: the interface size rescales the whole
 * page — this row included — so a live update would slide the handle out from
 * under the cursor. The draft drives the readout during the drag.
 */
function InterfaceFontSizeSlider() {
  const dispatch = useAppDispatch();
  const stored = useAppSelector((s) => s.appSettings.interfaceFontSize);
  const [draft, setDraft] = useState(stored);
  const [syncedFrom, setSyncedFrom] = useState(stored);

  // Adjust during render rather than in an effect: keying the slider off
  // `stored` would remount it on every commit and drop keyboard focus mid-step.
  if (syncedFrom !== stored) {
    setSyncedFrom(stored);
    setDraft(stored);
  }

  return (
    <Slider
      value={draft}
      aria-label="Interface size"
      onChange={setDraft}
      onCommit={(next) => dispatch(setInterfaceFontSize(next))}
      min={MIN_INTERFACE_FONT_SIZE}
      max={MAX_INTERFACE_FONT_SIZE}
      step={1}
      formatValue={(size) => `${size}px`}
    />
  );
}

function CodeFontSizeSlider() {
  const dispatch = useAppDispatch();
  const value = useAppSelector((s) => s.appSettings.codeFontSize);

  return (
    <Slider
      value={value}
      aria-label="Code size"
      onChange={(next) => dispatch(setCodeFontSize(next))}
      min={MIN_CODE_FONT_SIZE}
      max={MAX_CODE_FONT_SIZE}
      step={1}
      formatValue={(size) => `${size}px`}
    />
  );
}

export default function GeneralSettings() {
  const {
    state: updateState,
    check: checkUpdate,
    install: installUpdate,
  } = useAutoUpdate();
  const caps = useCapabilities();
  const isMobile = useIsMobile();

  const handleThemeChange = (value: ThemeValue) => {
    const labelMap = { light: "Light", system: "Auto", dark: "Dark" };
    toast.success(`Theme changed to ${labelMap[value]}`);
  };

  return (
    <SettingsPageShell title="General">
      <SettingsSection title="Run">
        <SettingsRow
          title="Run Detail"
          description="Control how much detail is shown in run output"
        >
          <RunDetailSelect />
        </SettingsRow>
        {caps.preventSleep && (
          <>
            <SettingsDivider />
            <SettingsRow
              title="Prevent Sleep"
              description="Keep your computer awake while a run is active"
            >
              <PreventSleepToggle />
            </SettingsRow>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingsRow
          title="Theme"
          description="Choose your preferred color mode"
        >
          {isMobile ? (
            <ThemeSelect onChange={handleThemeChange} />
          ) : (
            <ThemePicker onChange={handleThemeChange} />
          )}
        </SettingsRow>

        <SettingsDivider />
        <SettingsRow
          title="Interface Size"
          description="Scales the whole interface — text, spacing, and controls"
        >
          <InterfaceFontSizeSlider />
        </SettingsRow>

        <SettingsDivider />
        <SettingsRow
          title="Code Size"
          description="Size of diffs, file previews, and code blocks"
        >
          <CodeFontSizeSlider />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Agents">
        <SettingsRow
          title="Active agents"
          description="Enable or disable agent runtimes"
        >
          <AgentsSection />
        </SettingsRow>
      </SettingsSection>

      {caps.windowChrome && (
        <SettingsSection title="Menu Bar">
          <SettingsRow
            title="Menu Bar Icon"
            description="Show the Mains icon in the system menu bar"
          >
            <MenuBarIconToggle />
          </SettingsRow>
        </SettingsSection>
      )}

      {caps.nativeNotifications && (
        <SettingsSection title="Notifications">
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
      )}

      {caps.autoUpdate && (
        <SettingsSection title="Software Updates">
          <SettingsRow
            title="Version"
            description={`Current version: v${__APP_VERSION__ ?? "1.0.0"}`}
          >
            <UpdateButton
              state={updateState}
              onCheck={checkUpdate}
              onInstall={installUpdate}
            />
          </SettingsRow>
        </SettingsSection>
      )}
    </SettingsPageShell>
  );
}
