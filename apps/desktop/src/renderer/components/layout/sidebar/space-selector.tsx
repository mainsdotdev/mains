import { Space } from "@/lib/redux/api";
import { iconColorClass, parseIcon } from "@/lib/icon-registry";
import { Button } from "@/components/ui";
import { ProviderUsageTooltip } from "@/features/settings/components/provider-usage-tooltip";

interface SpaceSelectorProps {
  spaces: Space[];
  activeSpaceId: string | null;
  onSpaceChange: (spaceId: string) => void;
  orientation?: "horizontal" | "vertical";
}

function SpaceSelector({
  spaces,
  activeSpaceId,
  onSpaceChange,
  orientation = "horizontal",
}: SpaceSelectorProps) {
  return (
    <div
      className={`flex items-center gap-1.5 noscrollbar px-1 ${
        orientation === "vertical"
          ? "min-h-0 flex-col overflow-y-auto overflow-x-hidden"
          : "overflow-x-auto"
      }`}
    >
      {spaces.map((space) => {
        const icon = parseIcon(space.icon);
        const isActive = activeSpaceId === space.id;

        return (
          <ProviderUsageTooltip
            key={space.id}
            id={`space-usage-${space.id}`}
            providerId={space.providerId}
            name={space.name}
            position={orientation === "vertical" ? "right" : "top"}
          >
            <Button
              onClick={() => onSpaceChange(space.id)}
              className={`shrink-0 flex items-center justify-center size-8 hover:bg-primary/50 dark:hover:bg-primary/20
                 rounded-xl transition-all duration-200 ease-out font-medium cursor-pointer ${
                   isActive
                     ? "text-primary-900 dark:text-primary"
                     : "text-primary-900 dark:text-primary opacity-50"
                 }`}
              aria-label={space.name}
              aria-describedby={`space-usage-${space.id}`}
              aria-pressed={isActive}
            >
              {icon.type === "emoji" ? (
                <span className="text-lg font-medium">{icon.value}</span>
              ) : (
                <icon.value
                  className={`size-4 ${
                    iconColorClass(icon.color) ||
                    "text-primary-800 dark:text-primary"
                  }`}
                />
              )}
            </Button>
          </ProviderUsageTooltip>
        );
      })}
    </div>
  );
}

export default SpaceSelector;
