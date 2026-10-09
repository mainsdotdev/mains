import { Button, Text } from "@/components/ui";
import { Star } from "@/components/ui/icons/space";
import type { AtlasPageAction } from "../lib/page-actions";
import { AtlasPageMenu } from "./atlas-page-menu";
import { AtlasPageIcon } from "./atlas-page-icon";

interface AtlasPageToolbarProps {
  title: string;
  icon?: string;
  isFavorite: boolean;
  trashed: boolean;
  collectionId: string | null;
  collections: { id: string; name: string }[];
  onBack: () => void;
  onFavorite: () => void;
  onAction: (action: AtlasPageAction) => void;
}

export function AtlasPageToolbar({
  title,
  icon,
  isFavorite,
  trashed,
  collectionId,
  collections,
  onBack,
  onFavorite,
  onAction,
}: AtlasPageToolbarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-4">
      <nav
        aria-label="Page breadcrumb"
        className="flex min-w-0 items-center gap-1 text-base"
      >
        <Button variant="ghost" className="shrink-0 p-0" onClick={onBack}>
          Pages
        </Button>
        <Text size="s" variant="muted" aria-hidden="true" className="shrink-0 text-primary-600">
          /
        </Text>
        <span aria-current="page" className="flex min-w-0 items-center gap-1">
          <AtlasPageIcon icon={icon} className="size-4 shrink-0 text-primary-600 dark:text-primary-400" />
          <Text as="span" size="s" variant="muted" className="truncate">
            {title || "Untitled page"}
          </Text>
        </span>
      </nav>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="icon"
          aria-label={
            isFavorite ? "Remove page from favorites" : "Add page to favorites"
          }
          aria-pressed={isFavorite}
          tooltip="Favorite"
          onClick={onFavorite}
        >
          <Star filled={isFavorite} className={isFavorite ? "text-accent" : ""} />
        </Button>
        <AtlasPageMenu
          trashed={trashed}
          collectionId={collectionId}
          collections={collections}
          onAction={onAction}
        />
      </div>
    </div>
  );
}
