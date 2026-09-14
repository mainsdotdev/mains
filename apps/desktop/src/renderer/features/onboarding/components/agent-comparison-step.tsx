import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  CopyButton,
  DropdownWrapper,
  Heading2,
  Text,
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

interface AgentColumn {
  slug: OnboardingAgentSlug;
  name: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  iconClassName?: string;
  subscription: string;
  features: string[];
  install: CliInstall;
}

const AGENT_COLUMNS: AgentColumn[] = [
  {
    slug: "claude",
    name: "Claude Code",
    Icon: Claude,
    iconClassName: "text-claude!",
    subscription: "Claude Pro / Max subscription",
    features: [
      "Deep multi-file codebase edits",
      "Subagents & background tasks",
      "Hooks, skills & slash commands",
      "Plugin marketplace",
      "MCP server support",
    ],
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
    subscription: "ChatGPT Plus / Pro subscription",
    features: [
      "Sandboxed command execution",
      "Image generation",
      "Plugin marketplace",
      "Document edit & view",
      "MCP server support",
    ],
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
    subscription: "GitHub Copilot subscription (free tier available)",
    features: [
      "GitHub-native issues & PRs",
      "Multiple frontier models",
      "Agentic terminal workflows",
      "Custom agents & instructions",
      "MCP server support",
    ],
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
    subscription: "Cursor Pro subscription (hobby tier available)",
    features: [
      "Composer-style agent edits",
      "Anthropic, OpenAI & Gemini models",
      "Terminal-native agent",
      "MCP server support",
    ],
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

const ROW_BORDER = "border-t border-primary-700/10 dark:border-primary-200/10";

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text as="div" weight="medium" className={cn(ROW_BORDER, "py-5 pr-4")}>
      {children}
    </Text>
  );
}

function RowCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        ROW_BORDER,
        "flex flex-col items-center justify-center gap-1 px-2 py-5 text-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

function EnableButton({
  isSelected,
  interactive,
  disabledReason,
  onToggle,
}: {
  isSelected: boolean;
  interactive: boolean;
  /** Why the button is inert — shown on hover, since a dead control explains nothing. */
  disabledReason?: string;
  onToggle: () => void;
}) {
  // Clicking flips the state under a pointer that is still hovering, which
  // would instantly show the opposite preview again. Disarm the preview on
  // click and re-arm it once the pointer leaves the button.
  const [previewArmed, setPreviewArmed] = useState(true);
  const showPreview = interactive && previewArmed;

  return (
    <Button
      onClick={() => {
        setPreviewArmed(false);
        onToggle();
      }}
      onMouseLeave={() => setPreviewArmed(true)}
      disabled={!interactive}
      tooltip={!interactive ? disabledReason : undefined}
      className={cn(
        "group min-w-26 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        isSelected
          ? cn(
              "glass-success text-white",
              showPreview && "hover:glass-danger hover:text-white",
            )
          : cn(
              "bg-primary-500/10 text-primary-600 dark:text-primary-400",
              showPreview && "hover:bg-success/15 hover:text-success",
            ),
      )}
    >
      {/* Both labels stay mounted, stacked; hover cross-fades between them */}
      <span className="relative block">
        <span
          className={cn(
            "block transition-opacity duration-200",
            showPreview && "group-hover:opacity-0",
          )}
        >
          {isSelected ? "Enabled" : "Disabled"}
        </span>
        {showPreview && (
          <span
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            aria-hidden
          >
            {isSelected ? "Disable" : "Enable"}
          </span>
        )}
      </span>
    </Button>
  );
}

/**
 * "CLI not detected" badge that opens an install-instructions popover — the
 * content the old per-agent CLI setup modal steps used to show.
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
        className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-warning/15 px-3 py-1 text-sm font-medium text-warning transition-colors hover:bg-warning/25"
      >
        CLI not detected
        <Download className="size-3 transition-transform duration-200" />
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
 * First onboarding step: a Dayflow-style comparison table of the supported
 * coding agents, with an enable/disable toggle per agent. Toggles drive the
 * same space archive/unarchive flow the old welcome step used.
 */
export function AgentComparisonStep() {
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
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-12 space-y-2 text-center">
         <Heading2 className="font-mono tracking-tight">
          Choose your agents
        </Heading2>

      </div>

      <div className="grid grid-cols-[minmax(150px,210px)_repeat(4,minmax(0,1fr))_minmax(0,0.7fr)]">
        {/* Header row */}
        <div />
        {AGENT_COLUMNS.map(({ slug, name, Icon, iconClassName }) => (
          <div key={slug} className="flex flex-col items-center gap-3 pb-8">
            <span className="flex size-14 items-center justify-center rounded-full glass-outline ">
              <Icon
                className={cn(
                  "size-7 text-primary-900 dark:text-primary-100",
                  iconClassName,
                )}
              />
            </span>
            <Text as="span" size="base" weight="medium">
              {name}
            </Text>
          </div>
        ))}
        {/* Coming-soon column: Gemini + Grok share one column */}
        <div className="flex flex-col items-center gap-3 pb-8 opacity-70">
          <div className="flex items-center gap-1.5 pt-2">
            <span className="flex size-10 items-center justify-center rounded-full glass-outline">
              <Gemini className="size-5" />
            </span>
            <span className="flex size-10 items-center justify-center rounded-full glass-outline">
              <Grok className="size-5 text-primary-900 dark:text-primary-100" />
            </span>
          </div>
          <Text as="span" size="base" weight="semibold">
            Gemini &amp; Grok
          </Text>
        </div>

        {/* CLI status */}
        <RowLabel>Status</RowLabel>
        {AGENT_COLUMNS.map(({ slug, name, install }) => {
          const installed = detectedClis?.[slug];
          return (
            <RowCell key={slug}>
              {detectedClis !== undefined && !installed ? (
                <CliInstallBadge
                  name={name}
                  install={install}
                  onRecheck={() => void refetchClis()}
                  isRechecking={isDetecting}
                />
              ) : (
                <Text
                  as="span"
                  weight="medium"
                  tone={detectedClis === undefined ? "subtle" : "success"}
                  className={cn(
                    "inline-flex items-center rounded-full px-3 py-1 ",
                    detectedClis === undefined
                      ? "bg-primary-500/10 "
                      : "bg-success/5 glass-outline glass-outline-soft",
                  )}
                >
                  {detectedClis === undefined ? "Checking…" : "CLI detected"}
                </Text>
              )}
            </RowCell>
          );
        })}
        {/* Spans every body row of the coming-soon column */}
        <RowCell className="row-span-4">
          <Text as="span" tone="subtle" className="italic">
            Soon…
          </Text>
        </RowCell>

        {/* How the agent is used — subscription today, API may come later */}
        <RowLabel>Works with</RowLabel>
        {AGENT_COLUMNS.map(({ slug, subscription }) => (
          <RowCell key={slug}>
            <Text as="span" size="s" tone="muted">
              {subscription}
            </Text>
          </RowCell>
        ))}

        {/* Features */}
        <RowLabel>Features</RowLabel>
        {AGENT_COLUMNS.map(({ slug, features }) => (
          <RowCell key={slug} className="justify-start gap-1.5">
            {features.map((feature) => (
              <Text
                key={feature}
                as="span"
                size="xs"
                tone="muted"
                className="leading-snug"
              >
                {feature}
              </Text>
            ))}
          </RowCell>
        ))}

        {/* Enable buttons — hover previews the opposite state, click applies it */}
        <RowLabel>Enabled</RowLabel>
        {AGENT_COLUMNS.map(({ slug, name }) => {
          const space = spacesBySlug.get(slug);
          const isSelected = !!space && !space.isArchived;
          const cannotArchiveLast = isSelected && visibleAgentCount <= 1;
          // Enabling an agent whose CLI is missing would hand over a space
          // that cannot run a single turn. Turning one OFF is never blocked
          // by this — only the last-one-standing rule does that.
          const cliMissing =
            !isSelected && anyCliDetected && !detectedClis?.[slug];
          const interactive = !!space && !cannotArchiveLast && !cliMissing;
          return (
            <RowCell key={slug}>
              <EnableButton
                isSelected={isSelected}
                interactive={interactive}
                disabledReason={
                  cliMissing
                    ? `Install the ${name} CLI first`
                    : cannotArchiveLast
                      ? "At least one agent has to stay enabled"
                      : undefined
                }
                onToggle={() => toggleAgent(slug)}
              />
            </RowCell>
          );
        })}
      </div>
    </div>
  );
}
