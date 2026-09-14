import { useRef, useState, type MouseEvent } from "react";
import {
  AnimatedTitle,
  AsciiSpinner,
  type AsciiSpinnerVariant,
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSub,
  Input,
  Text,
} from "@/components/ui";
import { Archive, Edit, OpenWith, Option, Trash } from "@/components/ui/icons";
import type { Collection, RecentRun } from "@/lib/redux/api";
import { ProjectIcon } from "./project-icon";

/** What the row prints — title, else the goal's first line. */
export function chatLabel(run: Pick<RecentRun, "title" | "goal">): string {
  const title = run.title?.trim();
  if (title) return title;
  const goalLine = run.goal?.split("\n").find((line) => line.trim())?.trim();
  if (goalLine) return goalLine;
  return "Untitled chat";
}

/**
 * Run timestamps are typed as numbers but arrive as `Date` locally (Drizzle)
 * and tagged over WebSocket — normalize rather than trust either.
 */
function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Compact relative age: "now", "5m", "2h", "3d". */
function timeAgo(value: unknown): string | null {
  const ms = toEpochMs(value);
  if (ms === null) return null;
  const delta = Date.now() - ms;
  if (delta < 60_000) return "now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface ChatItemProps {
  run: RecentRun;
  variant: AsciiSpinnerVariant;
  isActive: boolean;
  isRecent?: boolean;
  onSelect: () => void;
  /** Reversible: the chat leaves the list but is restorable in Settings → Archive. */
  onArchive: () => void;
  /** Permanent: the run row and its turns go for good. Confirmed by the caller. */
  onDelete: () => void;
  onRename: (title: string) => void;
  collections: Collection[];
  onMove: (collectionId: string | null) => void;
}

export function ChatItem({
  run,
  variant,
  isActive,
  isRecent = false,
  onSelect,
  onArchive,
  onDelete,
  onRename,
  collections,
  onMove,
}: ChatItemProps) {
  const isLive = run.status === "running" || run.status === "queued";
  const age = timeAgo(run.updatedAt);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  // Escape leaves without saving, but it also blurs the input — this tells the
  // blur handler the edit was already abandoned.
  const abandoned = useRef(false);

  const label = chatLabel(run);
  const isEditing = draft !== null;

  const startRename = () => {
    setIsMenuOpen(false);
    abandoned.current = false;
    setDraft(label);
  };

  const commitRename = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next && next !== label) onRename(next);
  };

  const openMenu = (event: MouseEvent) => {
    event.stopPropagation();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setMenuPosition({ x: rect.right, y: rect.bottom });
    setIsMenuOpen(true);
  };

  const move = (collectionId: string | null) => {
    setIsMenuOpen(false);
    onMove(collectionId);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={isEditing ? undefined : onSelect}
        onKeyDown={(e) => {
          if (isEditing) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={`group/chat w-full flex items-center gap-1.5 pr-2.5 py-1 rounded-[10px] cursor-pointer transition-colors ${
          isRecent ? "pl-2.5" : "pl-7"
        } ${
          isActive
            ? "bg-primary/50 glass-outline dark:bg-primary/5"
            : "hover:bg-primary/50 dark:hover:bg-primary/5"
        }`}
      >
        {/* Two homes for one indicator. An indented project row has an empty
            gutter to hang it in, so labels stay aligned whether or not a chat
            is running. A Recents row is flush with the sidebar's edge — hung
            there the spinner lands outside the row, so it takes a place in the
            flow instead and nudges the label across while the run is live. */}
        {isLive && isRecent && (
          // The slot reserves width in the flow; the spinner itself is taken
          // out of it. A box with no in-flow content cannot set the row's
          // height, so a live chat and an idle one measure exactly the same —
          // the same reason the indented rows hang theirs in the gutter.
          <span className="relative shrink-0 w-3 self-stretch">
            <span className="absolute inset-0 flex items-center justify-center">
              <AsciiSpinner variant={variant} kind="circle" />
            </span>
          </span>
        )}
        <span className="relative min-w-0 flex-1">
          {isLive && !isRecent && (
            <span className="pointer-events-none absolute right-full top-1/2 mr-1.5 -translate-y-1/2">
              <AsciiSpinner variant={variant} kind="circle" />
            </span>
          )}
          {isEditing ? (
            <Input
              variant="bare"
              value={draft}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => {
                if (abandoned.current) setDraft(null);
                else commitRename();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  abandoned.current = true;
                  setDraft(null);
                }
              }}
              aria-label="Chat title"
              className="block w-full bg-transparent text-s text-primary-950 dark:text-primary"
            />
          ) : (
            // The title is written twice: the generated one lands seconds
            // after the run starts, and a rename replaces it. Both arrive as a
            // prop change, and the wipe is what tells them apart from a
            // re-render — the same treatment the run tab gives its title.
            // Tone stays on `Text`; the animated span only carries layout.
            <Text
              as="span"
              size="s"
              tone={isActive ? "contrast" : "default"}
              className="block min-w-0"
            >
              <AnimatedTitle title={label} className="block truncate" />
            </Text>
          )}
        </span>
        <div
          className={`ml-auto flex items-center gap-1 shrink-0 ${
            isEditing ? "hidden" : ""
          }`}
        >
          {age && (
            <Text
              as="span"
              size="xxs"
              tone="secondary"
              className="tabular-nums group-hover/chat:hidden"
            >
              {age}
            </Text>
          )}
          <Button
            ref={triggerRef}
            tooltip="Chat options"
            onClick={openMenu}
            className="hidden group-hover/chat:flex items-center p-0.5 cursor-pointer rounded-md"
            aria-label="Chat options"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
          >
            <Option className="w-3.5 h-3.5 text-primary-800 dark:text-primary-200" />
          </Button>
        </div>
      </div>
      <DropdownMenu
        isOpen={isMenuOpen}
        aria-label="Chat actions"
        position={menuPosition}
        origin="top-left"
        onClose={() => setIsMenuOpen(false)}
      >
        <DropdownMenuItem onClick={startRename}>
          <Edit className="size-3.5" />
          <span>Rename</span>
        </DropdownMenuItem>
        <DropdownMenuSub
          label={
            <>
              <OpenWith className="size-3.5" />
              <span>Move</span>
            </>
          }
        >
          <DropdownMenuItem
            selected={run.collectionId === null}
            indicator="none"
            onClick={() => move(null)}
          >
            {/* Holds the icon column open so every label starts at the same
                place — "no project" has no icon to show. */}
            <span className="size-3.5 shrink-0" />
            <span>No project</span>
          </DropdownMenuItem>
          {collections.map((collection) => (
            <DropdownMenuItem
              key={collection.id}
              selected={run.collectionId === collection.id}
              indicator="none"
              onClick={() => move(collection.id)}
            >
              <ProjectIcon
                icon={collection.icon}
                projectName={collection.name}
              />
              <span className="truncate">{collection.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSub>
        <DropdownMenuItem
          onClick={() => {
            setIsMenuOpen(false);
            onArchive();
          }}
        >
          <Archive className="size-3.5" />
          <span>Archive</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="danger"
          onClick={() => {
            setIsMenuOpen(false);
            onDelete();
          }}
        >
          <Trash className="size-3.5" />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenu>
    </>
  );
}
