import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useSidebarConfig } from "@/hooks/use-sidebar-config";

export function useSettingsNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeSpace } = useActiveSpace();
  const sidebarConfig = useSidebarConfig();

  // Derived directly from the URL — no local mirror state needed. Avoids the
  // setState-during-render dance the previous version used to keep them in sync.
  const isSettingsOpen = location.pathname.startsWith("/settings");
  const [previousLocation, setPreviousLocation] = useState<{
    path: string;
    spaceId: string | null;
  } | null>(null);

  const handleOpenSettings = () => {
    setPreviousLocation({
      path: location.pathname + location.search,
      spaceId: activeSpace?.id ?? null,
    });
    navigate("/settings?section=general");
  };

  const handleCloseSettings = () => {
    if (previousLocation) {
      // A space switch can invalidate a workspace route while Settings is open.
      if (previousLocation.spaceId !== (activeSpace?.id ?? null)) {
        navigate(sidebarConfig.defaultRoute, { replace: true });
      } else {
        navigate(previousLocation.path);
      }
      setPreviousLocation(null);
    } else {
      navigate(sidebarConfig.defaultRoute);
    }
  };

  return {
    isSettingsOpen,
    handleOpenSettings,
    handleCloseSettings,
  };
}
