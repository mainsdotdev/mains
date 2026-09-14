import { useLayoutEffect, useRef } from "react";
import { Button, Input } from "@/components/ui";
import { Search, Close } from "@/components/ui/icons";

interface SearchBarProps {
  isExpanded: boolean;
  searchQuery: string;
  onToggle: () => void;
  onSearchChange: (value: string) => void;
  onClear: () => void;
}

export default function SearchBar({
  isExpanded,
  searchQuery,
  onToggle,
  onSearchChange,
  onClear,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (isExpanded) {
      inputRef.current?.focus();
    }
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
            ref={inputRef}
            type="text"
            placeholder="Search"
            aria-label="Search sidebar"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-9 bg-primary-950/5 dark:bg-primary/5 border-none
                        rounded-xl pl-9 pr-10 text-sm text-primary-900 dark:text-primary
                        placeholder:text-primary-500 dark:placeholder:text-primary-500
                        transition-colors duration-200 focus:outline-none focus:bg-primary/20 dark:focus:bg-primary/10 "
          />
          <Button
            tooltip="Clear search"
            onClick={onClear}
            className="absolute cursor-pointer right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-primary/20 dark:hover:bg-primary/10 rounded-md transition-colors duration-200"
          >
            <Close className="w-3.5 h-3.5 text-primary-900 dark:text-primary-100" />
          </Button>
        </div>
      ) : (
        <Button
          onClick={onToggle}
          tooltip="Search item"
          tooltipPosition="top"
          className="p-2 cursor-pointer duration-200 flex items-center justify-center hover:bg-primary/20 dark:hover:bg-primary/10 rounded-xl transition-colors"
        >
          <Search className="w-4 h-4 text-primary-900 dark:text-primary-100" />
        </Button>
      )}
    </div>
  );
}
