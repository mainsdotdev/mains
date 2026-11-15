import { useId, useLayoutEffect, useRef } from "react";
import { Button, Input } from "@/components/ui";
import { Search, Close } from "@/components/ui/icons";

interface SearchBarProps {
  isExpanded: boolean;
  searchQuery: string;
  onToggle: () => void;
  onSearchChange: (value: string) => void;
  onClear: () => void;
  searchLabel?: string;
}

export default function SearchBar({
  isExpanded,
  searchQuery,
  onToggle,
  onSearchChange,
  onClear,
  searchLabel = "Search sidebar",
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const inputId = useId();

  useLayoutEffect(() => {
    if (isExpanded) {
      inputRef.current?.focus();
    } else if (wasExpanded.current) {
      buttonRef.current?.focus();
    }
    wasExpanded.current = isExpanded;
  }, [isExpanded]);

  return (
    <div
      className={`relative h-9 flex items-center ${
        isExpanded ? "flex-1" : "w-auto"
      }`}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {isExpanded ? (
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-900 dark:text-primary-100 " />
          <Input
            variant="bare"
            id={inputId}
            ref={inputRef}
            type="text"
            placeholder="Search"
            aria-label={searchLabel}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClear(); } }}
            className="w-full h-9 bg-primary-950/5 dark:bg-primary/5 border-none
                        rounded-xl pl-9 pr-10 text-sm text-primary-900 dark:text-primary
                        placeholder:text-primary-500 dark:placeholder:text-primary-500
                        transition-colors duration-200 focus:outline-none focus:bg-primary/20 dark:focus:bg-primary/10 "
          />
          <Button
            variant="icon" iconSize="sm"
            tooltip="Clear search"
            aria-label="Clear search"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2"
          >
            <Close className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          variant="icon"
          ref={buttonRef}
          onClick={onToggle}
          tooltip={searchLabel}
          aria-label={searchLabel}
          aria-expanded={isExpanded}
          tooltipPosition="top"
        >
          <Search className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
