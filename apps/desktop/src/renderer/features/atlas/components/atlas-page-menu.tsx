import type { ReactNode } from "react";
import { DropdownMenuItem, DropdownMenuSub } from "@/components/ui";
import {
  Clipboard,
  Clock,
  Download,
  Ellipsis,
  ProjectFolder,
  Trash,
} from "@/components/ui/icons";
import type { AtlasPageAction } from "../lib/page-actions";
import { AtlasMenu } from "./atlas-menu";

export function AtlasPageMenu({
  trashed,
  collectionId,
  collections,
  onAction,
  label = "Page options",
  className = "size-6 rounded-lg text-primary-500 hover:bg-primary/5",
  trigger = <Ellipsis className="size-4" />,
  side = "bottom",
}: {
  trashed: boolean;
  collectionId: string | null;
  collections: { id: string; name: string }[];
  onAction: (action: AtlasPageAction) => void;
  label?: string;
  className?: string;
  trigger?: ReactNode;
  side?: "bottom" | "right";
}) {
  return (
    <AtlasMenu
      label={label}
      className={className}
      trigger={trigger}
      side={side}
    >
      {(close) => {
        const act = (action: AtlasPageAction) => {
          close();
          onAction(action);
        };
        return (
          <>
            <DropdownMenuItem onClick={() => act({ type: "copy" })}>
              <Clipboard className="size-4" />
              Copy page contents
            </DropdownMenuItem>

            <DropdownMenuSub
              label={
                <>
                  <Download className="size-4 rotate-180" />
                  Export
                </>
              }
            >
              <DropdownMenuItem
                onClick={() => act({ type: "export", format: "markdown" })}
              >
                Markdown
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => act({ type: "export", format: "json" })}
              >
                JSON
              </DropdownMenuItem>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={trashed}
              onClick={() => act({ type: "import" })}
            >
              <Download className="size-4" />
              Import
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => act({ type: "history" })}>
              <Clock className="size-4" />
              Page history
            </DropdownMenuItem>
            <DropdownMenuSub
              label={
                <>
                  <ProjectFolder className="size-4" />
                  Move to
                </>
              }
            >
              {[{ id: "", name: "No project" }, ...collections].map(
                (collection) => (
                  <DropdownMenuItem
                    key={collection.id}
                    disabled={trashed}
                    selected={(collectionId ?? "") === collection.id}
                    onClick={() =>
                      act({ type: "move", collectionId: collection.id || null })
                    }
                  >
                    {collection.name}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={trashed}
              variant="danger"
              onClick={() => act({ type: "trash" })}
            >
              <Trash className="size-4" />
              Move to Trash
            </DropdownMenuItem>
          </>
        );
      }}
    </AtlasMenu>
  );
}
