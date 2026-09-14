import { Plus } from "@/components/ui/icons";
import { parseLabels } from "@/lib/label-colors";
import { ProviderIcon } from "./provider-icon";
import { Button, Text } from "@/components/ui";

interface IssueData {
  issue: {
    entityId: string;
    provider: string;
    state: string;
    number: number | null;
    labels: string | null;
    priority?: number | null;
  };
  entity: {
    id: string;
    title: string | null;
  };
}

interface IssueListItemProps {
  issue: IssueData;
  isActive: boolean;
  onClick: () => void;
  onAddToContext?: () => void;
}


export function IssueListItem({
  issue,
  isActive,
  onClick,
  onAddToContext,
}: IssueListItemProps) {
  const { issue: iss, entity } = issue;
  const labels = parseLabels(iss.labels);
  const title = entity.title || `Issue #${iss.number ?? "?"}`;

  const handleAddToContext = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToContext?.();
  };

  const handleClick = (_e: React.MouseEvent) => {
    onClick();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(e as any); } }}
      className={`w-full text-left px-3 py-2  rounded-2xl cursor-pointer transition-all duration-200 ease-out flex items-center gap-2 group ${
        isActive
          ? "bg-primary/80 dark:bg-primary/5 glass-outline"
          : "bg-transparent hover:bg-primary/20 dark:hover:bg-primary/5"
      }`}
    >
      {/* Provider badge - left, vertically centered */}
      <ProviderIcon provider={iss.provider} className="size-4 shrink-0 text-primary-800 dark:text-primary-200" />

      {/* Content - title on top, labels below */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <Text as="span" size="s" tone="default" weight="medium" className="truncate">
          {title}
        </Text>

        {labels.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {labels.map((label) => (
              <span
                key={label}
                className={`inline-block capitalize px-2 py-px text-xxs font-medium rounded-full glass-primary  text-primary-800 dark:text-primary-200`}
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Add to context button - right, vertically centered */}
      {onAddToContext && (
        <Button
          onClick={handleAddToContext}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary/20 dark:hover:bg-primary/10 transition-all"
          title="Add to context"
        >
          <Plus className="w-3 h-3 text-primary-600 dark:text-primary-400" />
        </Button>
      )}
    </div>
  );
}
