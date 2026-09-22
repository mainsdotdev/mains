import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  CopyButton,
  DropdownWrapper,
  Heading2,
  Text,
  Toggle,
} from "@/components/ui";
import { useClickOutside } from "@/hooks/use-click-outside";
import {
  Download,
  CodexColor,
  CopilotStatic,
  Cursor,
  Gemini,
  Grok,
} from "@/components/ui/icons";
import { Claude } from "@/components/ui/icons/space";
import { cn } from "@/lib/cn";
import { getSpaceDefaultRoute } from "@/lib/route-utils";
import {
  useGetAppSettingsQuery,
  useArchiveSpaceMutation,
  useSetActiveSpaceMutation,
  useDetectInstalledClisQuery,
} from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setOnboardingCliAutoSelectApplied } from "@/lib/redux/slices/appSettingsSlice";
import { type OnboardingAgentSlug } from "../onboarding-agents";
import { useAgentSpaces } from "../hooks/use-agent-spaces";

interface CliInstall {
  sections: { label: string; commands: string[] }[];
  docsUrl: string;
  docsLabel: string;
}

interface AgentRowInfo {
  slug: OnboardingAgentSlug;
  name: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  iconClassName?: string;
  /** What you need to use it — the one fact that differs between agents here. */
  subscription: string;
  install: CliInstall;
}

const AGENTS: AgentRowInfo[] = [
  {
    slug: "claude",
    name: "Claude Code",
    Icon: Claude,
    iconClassName: "text-claude!",
    subscription: "Claude Pro or Max subscription",
    install: {
      sections: [
        {
          label: "Install & authenticate:",
          commands: [
            "npm install -g @anthropic-ai/claude-code",
            "claude /login",
          ],
        },
      ],
      docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
      docsLabel: "Anthropic setup guide",
    },
  },
  {
    slug: "codex",
    name: "Codex",
    Icon: CodexColor,
    subscription: "ChatGPT Plus or Pro subscription",
    install: {
      sections: [
        {
          label: "Install & authenticate:",
          commands: ["npm install -g @openai/codex", "codex /login"],
        },
      ],
      docsUrl: "https://developers.openai.com/codex/cli",
      docsLabel: "Codex CLI setup guide",
    },
  },
  {
    slug: "copilot",
    name: "GitHub Copilot",
    Icon: CopilotStatic,
    subscription: "GitHub Copilot · free tier available",
    install: {
      sections: [
        { label: "Check authentication:", commands: ["gh auth status"] },
        { label: "If not authenticated:", commands: ["gh auth login"] },
      ],
      docsUrl: "https://github.com/features/copilot",
      docsLabel: "GitHub Copilot subscription",
    },
  },
  {
    slug: "cursor",
    name: "Cursor",
    Icon: Cursor,
    subscription: "Cursor Pro · hobby tier available",
    install: {
      sections: [
        {
          label: "Install & authenticate:",
          commands: ["curl https://cursor.com/install -fsS | bash", "agent"],
        },
      ],
      docsUrl: "https://docs.cursor.com/en/cli/overview",
      docsLabel: "Cursor CLI setup guide",
    },
  },
];

/** Same surface as the Preferences step's cards, so the two steps read as one flow. */
const CARD =
  "divide-y divide-primary-700/10 rounded-3xl bg-primary-100/40 p-2 glass-outline glass-outline-soft dark:divide-primary-200/10 dark:bg-primary-900/20";
const ROW = "flex items-center gap-4 px-4 py-3.5";

function AgentIcon({
  Icon,
  className,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  className?: string;
}) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl glass-outline glass-outline-soft">
      <Icon className={cn("size-5 text-primary-900 dark:text-primary-100", className)} />
    </span>
  );
}

/** "Installed" once detection finds the CLI; the install popover when it doesn't. */
function CliStatus({
  agent,
  installed,
  onRecheck,
  isRechecking,
}: {
  agent: AgentRowInfo;
  /** `undefined` while detection is still running. */
  installed: boolean | undefined;
  onRecheck: () => void;
  isRechecking: boolean;
}) {
  if (installed === undefined) {
    return (
      <Text as="span" size="xs" tone="subtle">
        Checking…
      </Text>
    );
  }
  if (!installed) {
    return (
      <CliInstallBadge
        name={agent.name}
        install={agent.install}
        onRecheck={onRecheck}
        isRechecking={isRechecking}
      />
    );
  }
  return (
    <Text as="span" size="xs" tone="success" className="flex items-center gap-1.5">
      <span aria-hidden className="size-1.5 rounded-full bg-success" />
      Installed
    </Text>
  );
}

/**
 * "Install CLI" chip that opens an install-instructions popover — the content
 * the old per-agent CLI setup modal steps used to show.
 */
function CliInstallBadge({
  name,
  install,
  onRecheck,
  isRechecking,
}: {
  name: string;
  install: CliInstall;
  /** Re-runs detection: the install happens in a terminal, out of our sight. */
  onRecheck: () => void;
  isRechecking: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(panelRef, close, triggerRef);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <Button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/25"
      >
        <Download className="size-3" />
        Install CLI
      </Button>
      <DropdownWrapper
        isOpen={open}
        role="dialog"
        aria-label={`${name} CLI setup`}
        usePortal
        triggerRef={triggerRef}
        dropdownRef={panelRef}
        matchTriggerWidth={false}
        minWidth="min-w-100"
      >
        <div className="w-100 space-y-3 p-4 text-left">
          <Text as="span" weight="medium" className="block">
            Set up the {name} CLI
          </Text>
          {install.sections.map((section) => (
            <div key={section.label} className="space-y-1.5">
              <Text as="span" size="xs" tone="subtle" className="block">
                {section.label}
              </Text>
              {section.commands.map((command) => (
                <div
                  key={command}
                  className="flex items-center rounded-lg bg-primary-200/60 px-3 py-2 dark:bg-primary-800/40"
                >
                  <Text
                    as="code"
                    size="xs"
                    tone="secondary"
                    className="flex-1 overflow-x-auto font-mono"
                  >
                    {command}
                  </Text>
                  <CopyButton text={command} />
                </div>
              ))}
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <Button
              onClick={() => window.api.shell.openExternal(install.docsUrl)}
              className="cursor-pointer text-xs text-primary-600 underline dark:text-primary-400"
            >
              {install.docsLabel}
            </Button>
            <Button
              onClick={onRecheck}
              disabled={isRechecking}
              className="cursor-pointer rounded-full bg-primary-200/60 px-3 py-1 text-xs font-medium text-primary-800 transition-colors hover:bg-primary-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-800/60 dark:text-primary-200 dark:hover:bg-primary-700"
            >
              {isRechecking ? "Checking…" : "Recheck"}
            </Button>
          </div>
        </div>
      </DropdownWrapper>
    </>
  );
}

/**
 * Onboarding step for the agents Mains drives: one row per agent with its
 * install state and an on/off switch. Deliberately not a comparison — every
 * enabled agent is used, side by side, so the step only asks which ones this
 * machine can run and which the user wants. Switches drive the same space
 * archive/unarchive flow the old welcome step used.
 */
export function AgentsStep() {
  const navigate = useNavigate();
  const { data: appSettings } = useGetAppSettingsQuery();
  const [archiveSpace] = useArchiveSpaceMutation();
  const [setActiveSpace] = useSetActiveSpaceMutation();
  const {
    data: detectedClis,
    isFetching: isDetecting,
    refetch: refetchClis,
  } = useDetectInstalledClisQuery();
  const hasAppliedAutoSelect = useRef(false);
  const dispatch = useAppDispatch();
  const autoSelectApplied = useAppSelector(
    (state) => state.appSettings.onboardingCliAutoSelectApplied,
  );

  const { agentSpaces, visibleAgentCount, spacesBySlug, toggleAgent } =
    useAgentSpaces();

  // Detection finding nothing at all is a PATH problem far more often than it
  // is four uninstalled CLIs, so the enable guard below stands down in that
  // case rather than leaving the user unable to enable anything.
  const anyCliDetected =
    !!detectedClis && Object.values(detectedClis).some(Boolean);

  // Installing a CLI means leaving for a terminal and coming back, so detection
  // re-runs on focus. (`refetchOnFocus` in baseApi does nothing — RTK Query's
  // `setupListeners` is never called — so this listener is the mechanism.)
  useEffect(() => {
    const onFocus = () => void refetchClis();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetchClis]);

  // One-time pre-selection: disable agents whose CLI isn't installed so the
  // toggles start from what will actually work on this machine.
  useEffect(() => {
    if (hasAppliedAutoSelect.current) return;
    if (!detectedClis) return;
    if (agentSpaces.length === 0) return;
    if (autoSelectApplied) return;

    const installedSpaces = agentSpaces.filter(
      (s) => detectedClis[s.slug as OnboardingAgentSlug],
    );

    hasAppliedAutoSelect.current = true;
    dispatch(setOnboardingCliAutoSelectApplied(true));

    if (installedSpaces.length === 0) {
      // Detection found nothing — likely PATH issue. Leave defaults alone.
      return;
    }

    const notInstalledVisible = agentSpaces.filter(
      (s) => !s.isArchived && !detectedClis[s.slug as OnboardingAgentSlug],
    );

    const activeId = appSettings?.activeSpaceId ?? null;
    const activeWillBeArchived = notInstalledVisible.some(
      (s) => s.id === activeId,
    );

    void (async () => {
      if (activeWillBeArchived) {
        const nextActive = installedSpaces
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)[0];
        try {
          await setActiveSpace(nextActive.id).unwrap();
          const route = getSpaceDefaultRoute(nextActive);
          setTimeout(() => navigate(route, { replace: true }), 0);
        } catch {
          // ignore
        }
      }
      for (const space of notInstalledVisible) {
        try {
          await archiveSpace(space.id).unwrap();
        } catch {
          // ignore — best-effort pre-selection
        }
      }
    })();
  }, [
    agentSpaces,
    detectedClis,
    appSettings?.activeSpaceId,
    archiveSpace,
    setActiveSpace,
    navigate,
    autoSelectApplied,
    dispatch,
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-10 space-y-3 text-center">
        <Heading2 className="font-mono tracking-tight">Your agents</Heading2>
        <Text as="p" tone="secondary">
          Mains runs every agent you have, side by side. Turn off any you
          don&apos;t use.
        </Text>
      </div>

      <section aria-label="Agents" className={CARD}>
        {AGENTS.map((agent) => {
          const { slug, name, Icon, iconClassName, subscription } = agent;
          const space = spacesBySlug.get(slug);
          const isEnabled = !!space && !space.isArchived;
          const isLastEnabled = isEnabled && visibleAgentCount <= 1;
          // Enabling an agent whose CLI is missing would hand over a space
          // that cannot run a single turn. Turning one OFF is never blocked
          // by this — only the last-one-standing rule does that.
          const cliMissing =
            !isEnabled && anyCliDetected && !detectedClis?.[slug];
          return (
            <div key={slug} className={ROW}>
              <AgentIcon Icon={Icon} className={iconClassName} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Text as="span" weight="medium">
                  {name}
                </Text>
                {/* A switch that won't move says why right here, not in a
                    tooltip a disabled control can't show. The missing-CLI
                    case needs no line: the Install chip beside it says it. */}
                <Text as="span" size="xs" tone="subtle" className="truncate">
                  {isLastEnabled ? "Keep at least one agent on" : subscription}
                </Text>
              </div>
              <CliStatus
                agent={agent}
                installed={detectedClis === undefined ? undefined : !!detectedClis[slug]}
                onRecheck={() => void refetchClis()}
                isRechecking={isDetecting}
              />
              <Toggle
                enabled={isEnabled}
                onChange={() => toggleAgent(slug)}
                disabled={!space || isLastEnabled || cliMissing}
                aria-label={`Use ${name}`}
                className="py-0"
              />
            </div>
          );
        })}

        <div className={cn(ROW, "opacity-60")}>
          {/* Both in one tile, so the names still line up with the rows above */}
          <span className="flex size-10 shrink-0 items-center justify-center gap-0.5 rounded-xl glass-outline glass-outline-soft">
            <Gemini className="size-4" />
            <Grok className="size-4 text-primary-900 dark:text-primary-100" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Text as="span" weight="medium">
              Gemini &amp; Grok
            </Text>
            <Text as="span" size="xs" tone="subtle">
              Coming soon
            </Text>
          </div>
        </div>
      </section>
    </div>
  );
}
