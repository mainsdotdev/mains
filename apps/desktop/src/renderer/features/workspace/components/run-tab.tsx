import { Archive, Option, Edit } from "@/components/ui/icons";
import type { Run } from "../types";
import { cn } from "@/lib/cn";
import { PROVIDER_VARIANTS, type ProviderVariant } from "@/lib/provider-variants";
import {
  AnimatedTitle,
  AsciiSpinner,
  DropdownMenu,
  DropdownMenuItem,
  Input,
} from "@/components/ui";
import { BaseTab } from "./base-tab";
import { useState, useRef, useCallback, useEffect } from "react";

interface RunTabProps {
  run: Run;
  isActive: boolean;
  isFirst?: boolean;
  onClick: () => void;
  onClose: () => void;
  onRename: (newTitle: string) => void;
  title: string;
  variant?: "copilot" | "claude" | "codex" | "cursor";
}

function VariantIcon({ variant }: { variant: string; isActive: boolean }) {


  const descriptor = PROVIDER_VARIANTS[variant as ProviderVariant];
  if (!descriptor) return null;
  const Icon = descriptor.icon;
  return <Icon className={cn("size-4", descriptor.accentClassName)} />;
}

function TabIcon({ run, variant, isActive }: { run: Run; variant: string; isActive: boolean }) {
  const isRunning = run.status === "running" || run.status === "queued";
  return (
    <span className="flex items-center justify-center size-4 shrink-0">
      {isRunning ? (
        <AsciiSpinner variant={variant as "claude" | "copilot" | "codex" | "cursor"} />
      ) : (
        <VariantIcon variant={variant} isActive={isActive} />
      )}
    </span>
  );
}

export function RunTab({ run, isActive, isFirst, onClick, onClose, onRename, title, variant = "copilot" }: RunTabProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 });
  const [dropdownOrigin, setDropdownOrigin] = useState<"top-left" | "top-right">("top-left");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleOptionsClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const el = (e.target as HTMLElement).closest("button") ?? (e.currentTarget as HTMLElement);
    const rect = el.getBoundingClientRect();
    const menuWidth = 140; // matches minWidth
    const isRight = rect.right + menuWidth > window.innerWidth - 8;
    setDropdownOrigin(isRight ? "top-right" : "top-left");
    setDropdownPosition({
      x: isRight ? rect.right - menuWidth : rect.left,
      y: rect.bottom + 4,
    });
    setIsDropdownOpen((prev) => !prev);
  }, []);

  const handleRenameStart = useCallback(() => {
    setRenameValue(title);
    setIsRenaming(true);
    setIsDropdownOpen(false);
  }, [title]);

  const handleRenameConfirm = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== title) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, title, onRename]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      handleRenameConfirm();
    } else if (e.key === "Escape") {
      setIsRenaming(false);
    }
  }, [handleRenameConfirm]);

  const handleArchive = useCallback(() => {
    setIsDropdownOpen(false);
    onClose();
  }, [onClose]);

  const label = isRenaming ? (
    <Input
      variant="bare"
      ref={inputRef}
      value={renameValue}
      onChange={(e) => setRenameValue(e.target.value)}
      onBlur={handleRenameConfirm}
      onKeyDown={handleRenameKeyDown}
      onClick={(e) => e.stopPropagation()}
      aria-label="Run title"
      className="text-xs font-medium text-primary-900 dark:text-primary-100 bg-transparent outline-none border-b border-primary-400 dark:border-primary-600 w-full"
      maxLength={50}
    />
  ) : (
    <AnimatedTitle title={title} className="text-xs font-medium tracking-tight text-primary-900 dark:text-primary-100 hover:text-primary-900 dark:hover:text-primary-100 truncate flex-1" />
  );

  return (
    <>
      <BaseTab
        isActive={isActive}
        isFirst={isFirst}
        onClick={onClick}
        onClose={handleOptionsClick}
        icon={<TabIcon run={run} variant={variant} isActive={isActive} />}
        label={label}
        tooltip={isRenaming ? undefined : run.title || run.goal || title}
        closeIcon={<Option className="size-3.5 text-primary-900 dark:text-primary-100 hover:text-primary-900 dark:hover:text-primary-100" />}
      />
      <DropdownMenu
        isOpen={isDropdownOpen}
        aria-label="Run actions"
        position={dropdownPosition}
        onClose={() => setIsDropdownOpen(false)}
        minWidth={140}
        origin={dropdownOrigin}
      >
        <DropdownMenuItem onClick={handleRenameStart}>
          <Edit className="size-3.5" />
          <span>Rename</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleArchive}>
          <Archive className="size-3.5" />
          <span>Archive</span>
        </DropdownMenuItem>
      </DropdownMenu>
    </>
  );
}

export function getTabTitle(run: Run): string {
  if (run.title) return run.title;
  if (run.goal) {
    const truncated = run.goal.length > 25 ? run.goal.substring(0, 25) + "..." : run.goal;
    return truncated;
  }
  return `Run ${run.id.substring(0, 8)}`;
}
