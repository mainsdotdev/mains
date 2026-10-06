import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

export function useAtlasSearch() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [value, setValue] = useState(query);
  const searchNavigation = useRef<string | null>(null);

  useEffect(() => {
    // A delayed URL update must not replace newer text in the input.
    if (searchNavigation.current === location.search) searchNavigation.current = null;
    else setValue(query);
  }, [location.key, location.search, query]);

  useEffect(() => {
    if (value === query) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      next.delete("focus");
      if (value) next.set("q", value); else next.delete("q");
      searchNavigation.current = next.size ? `?${next}` : "";
      setParams(next, { replace: true });
    }, 180);
    return () => clearTimeout(timer);
  }, [params, query, value, setParams]);

  return [value, setValue] as const;
}
