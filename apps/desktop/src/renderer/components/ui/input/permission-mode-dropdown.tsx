import { RefObject } from "react";
import { Plan, Lock, Edit, DontAsk, Danger, ArrowUp, Infinite } from "../icons";
import DropdownWrapper from "../dropdown-wrapper";
import { Button } from "../button";
import Tooltip from "../tooltip";
import { Body, Caption } from "../text";
import { useIsMobile } from "@/lib/platform";
import {
  CURSOR_MODES as CURSOR_MODE_DEFS,
  CODEX_SANDBOX_MODES as CODEX_SANDBOX_MODE_DEFS,
  CLAUDE_PERMISSION_MODES as CLAUDE_PERMISSION_MODE_DEFS,
  shortLabelMap,
} from "@/lib/provider-modes";

const PERMISSION_MODES = [
  {
    value: "default",
    label: "Ask permissions",
    description: "Ask before changes",
  },
  {
    value: "acceptEdits",
    label: "Auto accept edits",
    description: "Accept all edits",
  },
  {
    value: "plan",
    label: "Plan mode",
    description: "Plan before changes",
  },
  {
    value: "bypassPermissions",
    label: "Bypass permissions",
    description: "Bypass all permissions",
  },
] as const;

/**
 * Claude's list is its own, not the shared one above: it carries `auto` and
 * `dontAsk`, and Copilot — which reads the shared list — has no branch for
 * either, so offering them there would quietly behave as `default` while the
 * toolbar claimed otherwise.
 */
const CLAUDE_PERMISSION_MODES = CLAUDE_PERMISSION_MODE_DEFS;
const CLAUDE_PERMISSION_LABELS = shortLabelMap(CLAUDE_PERMISSION_MODE_DEFS);

/** Bypass trigger — sunburst (orange → amber → yellow), no filled background. */
const BYPASS_TRIGGER = {
  trigger:
    "font-medium bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 bg-clip-text text-transparent dark:from-orange-400 dark:via-amber-400 dark:to-yellow-400",
  icon: "text-warning",
  chevron: "text-warning",
} as const;

function isBypassPermissionMode(mode: string): boolean {
  return mode === "bypassPermissions" || mode === "danger-full-access";
}

const PERMISSION_MODE_LABELS: Record<string, string> = {
  default: "Ask",
  acceptEdits: "Edit",
  plan: "Plan",
  auto: "Auto",
  bypassPermissions: "Bypass",
  dontAsk: "Don't Ask",
};

const CURSOR_MODES = CURSOR_MODE_DEFS;
const CURSOR_MODE_LABELS = shortLabelMap(CURSOR_MODE_DEFS);
const CODEX_SANDBOX_MODES = CODEX_SANDBOX_MODE_DEFS;
const CODEX_SANDBOX_LABELS = shortLabelMap(CODEX_SANDBOX_MODE_DEFS);

/** Variants whose mode list differs from the shared one; the rest fall through. */
const MODES_BY_VARIANT: Record<
  string,
  readonly { value: string; label: string; description?: string }[]
> = {
  cursor: CURSOR_MODES,
  codex: CODEX_SANDBOX_MODES,
  claude: CLAUDE_PERMISSION_MODES,
};

const LABELS_BY_VARIANT: Record<string, Record<string, string>> = {
  cursor: CURSOR_MODE_LABELS,
  codex: CODEX_SANDBOX_LABELS,
  claude: CLAUDE_PERMISSION_LABELS,
};

function PermissionModeIcon({
  mode,
  className,
}: {
  mode: string;
  className?: string;
}) {
  switch (mode) {
    case "acceptEdits":
      return <Edit className={className} />;
    case "plan":
      return <Plan className={className} />;
    case "auto":
      return <Infinite className={className} />;
    case "bypassPermissions":
      return <Danger className={className} />;
    case "dontAsk":
      return <DontAsk className={className} />;
    case "agent":
      return <Infinite className={className} />;
    case "read-only":
      return <Lock className={className} />;
    case "workspace-write":
      return <Edit className={className} />;
    case "danger-full-access":
      return <Danger className={className} />;
    default:
      return <Lock className={className} />;
  }
}

function PlanToggleSwitch({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
        checked
          ? "bg-primary-500 dark:bg-primary-400"
          : "bg-primary-300/60 dark:bg-primary-700"
      }`}
    >
      <span
        className={`inline-block size-3 rounded-full bg-primary shadow-sm transition-transform ${
          checked ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}

interface PermissionModeDropdownProps {
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  dropdownRef: RefObject<HTMLDivElement | null>;
  variant?: string;
  modes?: readonly { value: string; label: string; description?: string }[];
  modeLabels?: Record<string, string>;
  /** Codex-only: plan mode runs alongside the sandbox mode. */
  planMode?: boolean;
  onPlanModeToggle?: () => void;
  /** Codex-only: when goal mode is on, plan mode is mutually exclusive and shown disabled. */
  goalMode?: boolean;
}

export function PermissionModeDropdown({
  permissionMode,
  onPermissionModeChange,
  isOpen,
  onToggle,
  dropdownRef,
  variant,
  modes: modesProp,
  modeLabels: modeLabelsProp,
  planMode = false,
  onPlanModeToggle,
  goalMode = false,
}: PermissionModeDropdownProps) {
  const isCodex = variant === "codex";
  const showPlanRow = isCodex && !!onPlanModeToggle;
  // Goal mode and plan mode are mutually exclusive — when goal is on, the plan
  // row is shown disabled with a tooltip pointing the user at the goal toggle.
  const planDisabled = goalMode;
  const modes = modesProp ?? MODES_BY_VARIANT[variant ?? ""] ?? PERMISSION_MODES;
  const modeLabels =
    modeLabelsProp ?? LABELS_BY_VARIANT[variant ?? ""] ?? PERMISSION_MODE_LABELS;
  const showPlanSuffix = showPlanRow && planMode && !planDisabled;
  const isBypass = isBypassPermissionMode(permissionMode);
  const isMobile = useIsMobile();
  const triggerIconClass = isBypass ? BYPASS_TRIGGER.icon : "";
  const triggerChevronClass = isBypass
    ? BYPASS_TRIGGER.chevron
    : "text-primary-600 dark:text-primary-400";
  return (
    <div className="relative mx-0.5" ref={dropdownRef}>
      <Button
        tooltip="Permission Mode"
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-sm transition-all cursor-pointer hover:bg-primary-200/30 animate-blur-reveal dark:hover:bg-primary-800 text-primary-950 dark:text-primary"
      >
        <PermissionModeIcon
          mode={permissionMode}
          className={`size-3.5 ${triggerIconClass}`}
        />
        {!isMobile && (
          <span className={isBypass ? BYPASS_TRIGGER.trigger : ""}>
            {modeLabels[permissionMode] ?? permissionMode}
            {showPlanSuffix ? " + Plan" : ""}
          </span>
        )}
        <ArrowUp
          className={`size-3.5 rotate-180 ${triggerChevronClass}`}
        />
      </Button>
      <DropdownWrapper
        isOpen={isOpen}
        aria-label="Permission mode"
        openUpward={true}
        minWidth={!isMobile ? "min-w-64" : "min-w-52"}
      >
        {modes.map((mode) => (
          <Button
            key={mode.value}
            type="button"
            role="menuitemradio"
            aria-checked={permissionMode === mode.value}
            onClick={() => {
              onPermissionModeChange(mode.value);
              onToggle();
            }}
            className={`w-full text-left px-2.5 py-1.5 cursor-pointer transition-colors flex items-center gap-2.5 first:rounded-t-xl ${
              !showPlanRow ? "last:rounded-b-xl" : ""
            } ${
              permissionMode === mode.value
                ? "bg-primary-200/60 dark:bg-primary-200/10 text-primary-950 dark:text-primary"
                : "hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300"
            }`}
          >
            <PermissionModeIcon
              mode={mode.value}
              className="size-3.5 shrink-0"
            />
            <div className="flex flex-col flex-1 min-w-0">
              <Body className="mb-0.5">{mode.label}</Body>
              <Caption>
                {mode.description}
              </Caption>
            </div>
          </Button>
        ))}
        {showPlanRow && (
          <Tooltip
            content="Disable goal mode to use plan mode"
            position="top"
            disabled={!planDisabled}
          >
            {/* `aria-disabled` rather than `disabled` — a truly disabled button
                swallows the hover events the Tooltip above needs to explain
                *why* the row is unavailable. */}
            <Button
              role="menuitemcheckbox"
              aria-checked={planMode && !planDisabled}
              tabIndex={planDisabled ? -1 : 0}
              aria-disabled={planDisabled}
              onClick={() => {
                if (!planDisabled) onPlanModeToggle?.();
              }}
              className={`w-full text-left px-2.5 py-1.5 transition-colors flex items-center gap-2.5 last:rounded-b-xl border-t border-primary-200/40 dark:border-primary/5 ${
                planDisabled
                  ? "cursor-not-allowed opacity-50 text-primary-600 dark:text-primary-400"
                  : planMode
                    ? "cursor-pointer bg-primary-200/60 dark:bg-primary-200/10 text-primary-950 dark:text-primary"
                    : "cursor-pointer hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300"
              }`}
            >
              <Plan className="size-3.5 shrink-0" />
              <div className="flex flex-col flex-1 min-w-0">
                <Body className="mb-0.5">Plan Mode</Body>
                <Caption>
                  Plan before changes
                </Caption>
              </div>
              <PlanToggleSwitch checked={planMode && !planDisabled} />
            </Button>
          </Tooltip>
        )}
      </DropdownWrapper>
    </div>
  );
}
