import { useEffect, useRef, useState } from "react";
import { Button, CopyButton, Input } from "@/components/ui";
import { ChevronUp, Refresh } from "@/components/ui/icons";
import {
  getProviderVariant,
  type ProviderVariant,
} from "@/lib/provider-variants";
import type { OnboardingProvider } from "../lib/onboarding-state";
import { useGetProviderAccountInfoQuery } from "@/lib/redux/api/providersApi";
import { useProviderAuthTerminal } from "@/features/workspace/hooks/use-provider-auth-terminal";
import { TerminalSection } from "@/features/workspace/components/terminal-section";

const SETUP: Record<ProviderVariant, { command: string | null; docs: string }> =
  {
    claude: {
      command: null,
      docs: "https://docs.anthropic.com/en/docs/claude-code",
    },
    codex: {
      command: "npm install -g @openai/codex",
      docs: "https://developers.openai.com/codex/cli",
    },
    copilot: {
      command: null,
      docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli",
    },
    cursor: {
      command: "curl https://cursor.com/install -fsS | bash",
      docs: "https://docs.cursor.com/en/cli/overview",
    },
  };

interface AgentsStepProps {
  options: OnboardingProvider[];
  value: ProviderVariant | null;
  onChange: (value: ProviderVariant) => void;
  isDetecting: boolean;
  hasError: boolean;
  onRecheck: () => void;
}

export function AgentsStep({
  options,
  value,
  onChange,
  isDetecting,
  hasError,
  onRecheck,
}: AgentsStepProps) {
  const [setup, setSetup] = useState<ProviderVariant | null>(null);
  const claude = getProviderVariant("claude");
  const copilot = getProviderVariant("copilot");
  const claudeOption = options.find((option) => option.variant === claude.variant);
  const copilotOption = options.find((option) => option.variant === copilot.variant);
  const claudeAccountQuery = useGetProviderAccountInfoQuery(claude.providerId, {
    skip: !claudeOption?.available,
    refetchOnFocus: true,
    refetchOnMountOrArgChange: true,
  });
  const copilotAccountQuery = useGetProviderAccountInfoQuery(copilot.providerId, {
    skip: !copilotOption?.available,
    refetchOnFocus: true,
    refetchOnMountOrArgChange: true,
  });
  const accountQueries: Partial<Record<ProviderVariant, typeof claudeAccountQuery>> = {
    claude: claudeAccountQuery,
    copilot: copilotAccountQuery,
  };
  const setupProvider = setup ? getProviderVariant(setup) : null;
  const setupOption = options.find((option) => option.variant === setup);
  const setupQuery = setup ? accountQueries[setup] : undefined;
  const connectedAccount = setupOption?.available ? setupQuery?.data?.account : null;
  const isSignedIn = !!connectedAccount;
  const isCheckingAccount = setupQuery?.isFetching ?? false;
  const authTerminal = useProviderAuthTerminal();
  const closeAuthTerminal = authTerminal.close;
  const authTerminalProviderId = authTerminal.session?.providerId;
  useEffect(() => closeAuthTerminal, [closeAuthTerminal]);
  const recheck = () => {
    onRecheck();
    for (const option of options) {
      if (option.available) void accountQueries[option.variant]?.refetch();
    }
  };
  const setupHeading = useRef<HTMLHeadingElement>(null);
  const setupTriggers = useRef<
    Partial<Record<ProviderVariant, HTMLButtonElement | null>>
  >({});
  const providerChoices = useRef<
    Partial<Record<ProviderVariant, HTMLInputElement | null>>
  >({});
  useEffect(() => {
    if (setup) setupHeading.current?.focus({ preventScroll: true });
  }, [setup]);
  useEffect(() => {
    if (
      isSignedIn &&
      authTerminalProviderId === setupProvider?.providerId
    ) {
      closeAuthTerminal();
      setupHeading.current?.focus({ preventScroll: true });
    }
  }, [
    setupProvider?.providerId,
    isSignedIn,
    authTerminalProviderId,
    closeAuthTerminal,
  ]);
  const closeSetup = () => {
    const previous = setup;
    setSetup(null);
    authTerminal.close();
    recheck();
    requestAnimationFrame(() => {
      if (previous) {
        (setupTriggers.current[previous] ?? providerChoices.current[previous])?.focus();
      }
    });
  };

  if (setup) {
    const provider = getProviderVariant(setup);
    const instructions = SETUP[setup];
    const Icon = provider.icon;
    const option = options.find((option) => option.variant === setup);
    const loginCommand =
      instructions.command === null
        ? setupQuery?.data?.cli?.authLoginCommand
        : provider.authLoginCommand;
    const activeTerminal = authTerminal.session?.providerId === provider.providerId
      ? authTerminal.session
      : null;
    return (
      <section
        className="onboarding-install"
        aria-label={`${provider.label} setup`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            closeSetup();
          }
        }}
      >
        <Button
          variant="subtle"
          className="onboarding-text-button"
          onClick={closeSetup}
        >
          <ChevronUp className="size-3.5 -rotate-90" /> All providers
        </Button>
        <Icon
          className={`onboarding-install-icon ${provider.accentClassName ?? ""}`}
        />
        <h2 ref={setupHeading} tabIndex={-1}>
          {isSignedIn ? "Signed in to" : option?.available ? "Sign in to" : "Set up"} {provider.label}
        </h2>
        <p>
          {isSignedIn
            ? connectedAccount?.type === "claude"
              ? `Signed in as ${connectedAccount.email}.`
              : connectedAccount?.type === "copilot" && connectedAccount.login
                ? `Signed in as ${connectedAccount.login}.`
                : `${provider.label} is ready to use.`
            : instructions.command
              ? "Install the CLI in your terminal, then sign in to your account."
              : option?.installed
                ? `Sign in to connect your ${provider.label} account. No separate installation is needed.`
                : `${provider.label} is included with Mains. Reinstall Mains to restore it, then recheck.`}
        </p>
        {instructions.command && (
          <div className="onboarding-command glass-outline">
            <code>{instructions.command}</code>
            <CopyButton
              variant="icon"
              tooltip="Copy install command"
              text={instructions.command}
            />
          </div>
        )}
        {instructions.command && <span className="onboarding-command-label">Sign in</span>}
        {instructions.command && (
          <div className="onboarding-command glass-outline">
            <code>{loginCommand ?? provider.authLoginCommand}</code>
            <CopyButton
              variant="icon"
              tooltip="Copy sign-in command"
              text={loginCommand ?? provider.authLoginCommand}
            />
          </div>
        )}
        <div className="onboarding-install-actions">
          <div className="onboarding-install-primary-actions">
            {isSignedIn ? (
              <Button
                variant="primary"
                onClick={() => {
                  onChange(provider.variant);
                  closeSetup();
                }}
              >
                Use {provider.label}
              </Button>
            ) : option?.available && loginCommand && (
              <Button
                variant="primary"
                onClick={() => authTerminal.open(provider.providerId, loginCommand)}
              >
                Sign in
              </Button>
            )}
            {!isSignedIn && (
              <Button
                variant="subtle"
                className="onboarding-text-button mt-2"
                onClick={() =>
                  void window.api.shell.openExternal(instructions.docs)
                }
              >
                Open setup guide <ChevronUp className="size-3.5 rotate-90" />
              </Button>
            )}
          </div>
          <Button
            variant="primary"
            className="onboarding-recheck"
            onClick={recheck}
            disabled={isDetecting || isCheckingAccount}
          >
            <Refresh className="size-3.5" />{" "}
            {isDetecting || isCheckingAccount ? "Checking…" : "Recheck"}
          </Button>
        </div>
        {activeTerminal && !isSignedIn && (
          <TerminalSection
            id={`onboarding-auth-${provider.providerId}`}
            isOpen
            title={`Sign in to ${provider.label}`}
            pendingCommand={activeTerminal.pendingCommand}
            onPendingCommandSent={authTerminal.markCommandSent}
            onClose={() => {
              authTerminal.close();
              recheck();
            }}
          />
        )}
        <p className="onboarding-panel-note" role="status">
          {isSignedIn
            ? "Your account is connected. You can continue setup."
            : option?.installed
              ? option.active
                ? "Go back to choose your provider. You can also sign in from your first chat."
                : "You can enable this provider in Settings after setup."
              : "Mains checks for the CLI here. Account access is checked when you start an agent."}
        </p>
      </section>
    );
  }

  return (
    <div className="onboarding-providers">
      <div className="onboarding-provider-toolbar">
        <span role="status">
          {isDetecting ? "Checking this Mac…" : "On this Mac"}
        </span>
        <Button
          variant="subtle"
          className="onboarding-text-button"
          onClick={recheck}
          disabled={isDetecting}
        >
          <Refresh className="size-3.5" /> Recheck
        </Button>
      </div>
      <fieldset className="onboarding-provider-list">
        <legend className="sr-only">Starting provider</legend>
        {options.map((option) => {
          const provider = getProviderVariant(option.variant);
          const Icon = provider.icon;
          const needsSignIn = option.available &&
            accountQueries[option.variant]?.data?.account === null;
          return (
            <div className="onboarding-provider-row" key={option.variant}>
              <label
                className="onboarding-provider-choice glass-outline"
                data-unavailable={!option.available || undefined}
              >
                <Input
                  variant="bare"
                  ref={(node) => {
                    providerChoices.current[option.variant] = node;
                  }}
                  type="radio"
                  className="sr-only"
                  name="starting-provider"
                  value={option.variant}
                  aria-label={provider.label}
                  checked={value === option.variant && option.available}
                  disabled={!option.available}
                  onChange={() => onChange(option.variant)}
                />
                <span className="onboarding-radio" aria-hidden="true" />
                <span className="onboarding-provider-copy">
                  <span className="onboarding-choice-title">
                    {provider.label}
                  </span>
                  <span className="onboarding-choice-description">
                    {!option.active
                      ? "Not active in Mains"
                      : option.installed === undefined
                        ? "Waiting for CLI detection"
                        : option.installed
                          ? needsSignIn
                            ? "Sign in required"
                            : option.source === "bundled"
                              ? "Included with Mains"
                              : "CLI detected"
                          : "CLI not found"}
                  </span>
                </span>
                <span className="onboarding-provider-icon" aria-hidden="true">
                  <Icon
                    className={`size-7 ${provider.accentClassName ?? ""}`}
                  />
                </span>
              </label>
              {(!option.available || needsSignIn) && (
                <Button
                  variant="primary"
                  ref={(node) => {
                    setupTriggers.current[option.variant] = node;
                  }}
                  className="onboarding-setup-button"
                  onClick={() => setSetup(option.variant)}
                  aria-label={`${needsSignIn ? "Sign in to" : "Set up"} ${provider.label}`}
                >
                  {needsSignIn ? "Sign in" : "Set up"}
                </Button>
              )}
            </div>
          );
        })}
      </fieldset>
      <p className="onboarding-panel-note" role="status">
        {hasError
          ? "Couldn’t check your providers. Recheck, or set up later."
          : !isDetecting && !options.some((option) => option.available)
            ? "No active CLI found. Set one up, recheck, or continue with Set up later."
            : "Pick the agent you’ll start with. You can sign in now or from your first chat."}
      </p>
    </div>
  );
}
