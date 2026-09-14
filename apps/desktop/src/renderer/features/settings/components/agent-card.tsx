import type { ComponentType } from "react";
import { Button, Text } from "@/components/ui";
import { Check, Plus } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import {
  PROVIDER_VARIANTS,
  type ProviderVariant,
} from "@/lib/provider-variants";

interface AgentChoice {
  slug: ProviderVariant;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

/** Selectable agent tiles, derived from the provider registry. */
export const AGENT_CHOICES: AgentChoice[] = Object.values(PROVIDER_VARIANTS).map(
  (d) => ({ slug: d.variant, label: d.label, Icon: d.icon }),
);

export function AgentCard({
  label,
  Icon,
  isSelected,
  onClick,
  disabled,
}: {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex flex-col items-stretch overflow-hidden rounded-2xl  transition-all duration-200 cursor-pointer flex-1 min-w-0 glass-card",
        isSelected
          ? " text-primary-900 dark:text-primary"
          : " text-primary-600 dark:text-primary-400 opacity-80 hover:opacity-100",
        disabled && "opacity-60 cursor-not-allowed",
      )}
      aria-pressed={isSelected}
    >
      <div className="flex flex-row items-center justify-center gap-1 px-4 min-w-24 py-2">
        <Icon className="size-3.5 shrink-0" />
        <Text
          as="span"
          size="xs"
          tone="inherit"
          weight="medium"
          className="leading-tight truncate"
        >
          {label}
        </Text>
      </div>
      <div
        className={cn(
          "flex items-center justify-center h-6 border-t transition-colors",
          isSelected
            ? "border-primary-200/40 dark:border-primary-800/40 text-success"
            : "border-primary-200/40 dark:border-primary-800/40 text-primary-600 dark:text-primary-400",
        )}
      >
        {isSelected ? (
          <Check className="size-3.5" />
        ) : (
          <Plus className="size-3.5" />
        )}
      </div>
    </Button>
  );
}
