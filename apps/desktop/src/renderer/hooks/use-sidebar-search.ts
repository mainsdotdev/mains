import { useState } from "react";

export function useSidebarSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  const handleSearchExpand = () => {
    setIsSearchExpanded(true);
  };

  const handleSearchClear = () => {
    setIsSearchExpanded(false);
    setSearchQuery("");
  };

  return {
    searchQuery,
    isSearchExpanded,
    setSearchQuery,
    handleSearchExpand,
    handleSearchClear,
  };
}
