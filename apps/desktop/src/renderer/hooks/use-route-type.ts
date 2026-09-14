import { useLocation } from "react-router-dom";
import { useMemo } from "react";
import { getRouteType, type RouteType } from "@/lib/route-utils";

export function useRouteType(): RouteType {
  const location = useLocation();

  return useMemo(() => {
    return getRouteType(location.pathname);
  }, [location.pathname]);
}
