/* eslint-disable @typescript-eslint/no-unused-vars */
import UserProfile from "./user-profile";
import SearchBar from "./search-bar";

interface SidebarHeaderProps {
  avatarUrl?: string;
  displayName?: string;
  isSearchExpanded: boolean;
  searchQuery: string;
  onSearchExpand: () => void;
  onSearchChange: (query: string) => void;
  onSearchClear: () => void;
}

export function SidebarHeader({
  avatarUrl,
  displayName,
  isSearchExpanded,
  searchQuery,
  onSearchExpand,
  onSearchChange,
  onSearchClear,
}: SidebarHeaderProps) {
  return (
    <div className="px-3 pt-12  shrink-0">
      {/* <div
        className={`flex items-center transition-all duration-200 ease-in-out ${
          isSearchExpanded ? "gap-0" : "gap-3"
        }`}
      >
        <UserProfile
          avatarUrl={avatarUrl}
          displayName={displayName}
          isVisible={!isSearchExpanded}
        />
        <SearchBar
          isExpanded={isSearchExpanded}
          searchQuery={searchQuery}
          onToggle={onSearchExpand}
          onSearchChange={onSearchChange}
          onClear={onSearchClear}
        />
      </div> */}
    </div>
  );
}
