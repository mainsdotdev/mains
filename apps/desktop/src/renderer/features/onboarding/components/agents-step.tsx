import { useEffect, useRef, useState } from "react";
import { Button, CopyButton, Input } from "@/components/ui";
import { ChevronUp, Refresh } from "@/components/ui/icons";
import {
  getProviderVariant,
  type ProviderVariant,
} from "@/lib/provider-variants";
import type { OnboardingProvider } from "../lib/onboarding-state";

const SETUP: Record<ProviderVariant, { command: string | null; docs: string }> =
  {
    claude: {
      command: "npm install -g @anthropic-ai/claude-code",
      docs: "https://docs.anthropic.com/en/docs/claude-code",
    },
    codex: {
      command: "npm install -g @openai/codex",
      docs: "https://developers.openai.com/codex/cli",
    },
    copilot: {
      command: "npm install -g @github/copilot",
      docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli",
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
  const setupHeading = useRef<HTMLHeadingElement>(null);
  const setupTriggers = useRef<
    Partial<Record<ProviderVariant, HTMLButtonElement | null>>
  >({});
  useEffect(() => {
    if (setup) setupHeading.current?.focus({ preventScroll: true });
  }, [setup]);
  const closeSetup = () => {
    const previous = setup;
    setSetup(null);
    requestAnimationFrame(() => {
      if (previous) setupTriggers.current[previous]?.focus();
    });
  };

  if (setup) {
    const provider = getProviderVariant(setup);
    const instructions = SETUP[setup];
    const Icon = provider.icon;
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
          Set up {provider.label}
        </h2>
        <p>Install the CLI in your terminal, then sign in to your account.</p>
        {instructions.command && (
          <div className="onboarding-command glass-outline">
            <code>{instructions.command}</code>
            <CopyButton
              variant="icon"
              tooltip="Copy install command"
              text={instructions.command}
              className="onboarding-copy-button"
            />
          </div>
        )}
        <span className="onboarding-command-label">Sign in</span>
        <div className="onboarding-command glass-outline">
          <code>{provider.authLoginCommand}</code>
          <CopyButton
            variant="icon"
            tooltip="Copy sign-in command"
            text={provider.authLoginCommand}
            className="onboarding-copy-button"
          />
        </div>
        <div className="onboarding-install-actions">
          <Button
            variant="subtle"
            className="onboarding-text-button"
            onClick={() =>
              void window.api.shell.openExternal(instructions.docs)
            }
          >
            Open setup guide <ChevronUp className="size-3.5 rotate-90" />
          </Button>
          <Button
            variant="primary"
            className="onboarding-recheck"
            onClick={onRecheck}
            disabled={isDetecting}
          >
            <Refresh className="size-3.5" />{" "}
            {isDetecting ? "Checking…" : "Recheck"}
          </Button>
        </div>
        <p className="onboarding-panel-note" role="status">
          {options.find((option) => option.variant === setup)?.installed
            ? options.find((option) => option.variant === setup)?.active
              ? "CLI detected. Go back to choose your provider."
              : "CLI detected. You can enable this provider in Settings after setup."
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
          onClick={onRecheck}
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
          return (
            <div className="onboarding-provider-row" key={option.variant}>
              <label
                className="onboarding-provider-choice glass-outline"
                data-unavailable={!option.available || undefined}
              >
                <Input
                  variant="bare"
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
                          ? "CLI detected"
                          : "CLI not found"}
                  </span>
                </span>
                <span className="onboarding-provider-icon" aria-hidden="true">
                  <Icon
                    className={`size-7 ${provider.accentClassName ?? ""}`}
                  />
                </span>
              </label>
              {!option.available && (
                <Button
                  variant="primary"
                  ref={(node) => {
                    setupTriggers.current[option.variant] = node;
                  }}
                  className="onboarding-setup-button"
                  onClick={() => setSetup(option.variant)}
                  aria-label={`Set up ${provider.label}`}
                >
                  Set up
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
            : "Pick the agent you’ll start with. Sign-in is checked on your first run."}
      </p>
    </div>
  );
}
