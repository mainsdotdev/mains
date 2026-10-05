import { useEffect, useRef } from "react";
import { Button, Input, Text } from "@/components/ui";
import { ArrowUp, Close, Search } from "@/components/ui/icons";

interface BrowserFindBarProps {
  query: string;
  activeMatchOrdinal: number;
  matches: number;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function BrowserFindBar({
  query,
  activeMatchOrdinal,
  matches,
  onQueryChange,
  onPrevious,
  onNext,
  onClose,
}: BrowserFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-1.5 border-b border-primary-200/50 bg-primary-50/70 px-2 py-1.5 dark:border-primary-800/50 dark:bg-primary-950/60">
      <Search className="ml-1 size-3.5 shrink-0 text-primary-400" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in page"
        aria-label="Find in page"
        className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-xs"
      />
      <Text
        as="span"
        size="xxs"
        tone="subtle"
        className="w-8 shrink-0 text-right tabular-nums"
      >
        {query ? `${activeMatchOrdinal}/${matches}` : "0/0"}
      </Text>
      <Button
        variant="icon" iconSize="sm"
        onClick={onPrevious}
        disabled={!query || matches === 0}
        tooltip="Previous match"
        tooltipShortcut="⇧↵"
        tooltipPosition="top"
        aria-label="Previous match"
      >
        <ArrowUp className="size-3.5 -rotate-90" />
      </Button>
      <Button
        variant="icon" iconSize="sm"
        onClick={onNext}
        disabled={!query || matches === 0}
        tooltip="Next match"
        tooltipShortcut="↵"
        tooltipPosition="top"
        aria-label="Next match"
      >
        <ArrowUp className="size-3.5 rotate-90" />
      </Button>
      <Button
        variant="icon" iconSize="sm"
        onClick={onClose}
        tooltip="Close find"
        tooltipShortcut="Esc"
        tooltipPosition="top-left"
        aria-label="Close find in page"
      >
        <Close className="size-3.5" />
      </Button>
    </div>
  );
}
