import {
  Apps,
  Asana,
  Github,
  Gitlab,
  Jira,
  Linear,
  Sentry,
  Trello,
} from "@/components/ui/icons";
import { Text } from "@/components/ui";
import type { ComponentType } from "react";

const PROVIDER_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  github: Github,
  linear: Linear,
  jira: Jira,
  asana: Asana,
  gitlab: Gitlab,
  trello: Trello,
  sentry: Sentry,
};

interface ProviderIconProps {
  provider: string;
  className?: string;
  fallback?: "text" | "icon";
}

export function ProviderIcon({
  provider,
  className = "w-4 h-4 shrink-0",
  fallback = "icon",
}: ProviderIconProps) {
  if (provider === "asana") {
    return <Asana className="h-5.5 w-6 scale-60 shrink-0" />;
  }

  const Icon = PROVIDER_ICONS[provider];

  if (!Icon) {
    if (fallback === "text") {
      return (
        <Text as="span" size="xs" tone="inherit" weight="medium" className="uppercase shrink-0">
          {provider.slice(0, 2)}
        </Text>
      );
    }
    return (
      <svg className={className} viewBox="0 0 16 16" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 0a1 1 0 11-2 0 1 1 0 012 0z"
        />
      </svg>
    );
  }

  return <Icon className={className} />;
}

function getProviderFromResourceKind(kind: string): string {
  const idx = kind.indexOf("_");
  return idx > 0 ? kind.substring(0, idx) : kind;
}

interface ResourceIconProps {
  kind: string;
  className?: string;
}

export function ResourceIcon({
  kind,
  className = "w-4 h-4 shrink-0",
}: ResourceIconProps) {
  const provider = getProviderFromResourceKind(kind);

  if (provider === "asana") {
    return <Asana className="h-5.5 w-6 scale-80 shrink-0" />;
  }
  if (provider === "jira") {
    return <Jira className="size-5 shrink-0" />;
  }

  const Icon = PROVIDER_ICONS[provider];
  if (!Icon) {
    return <Apps className={className} />;
  }

  return <Icon className={className} />;
}
