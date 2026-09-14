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
  const [previousPath, setPreviousPath] = useState<string | null>(null);

  const handleOpenSettings = () => {
    setPreviousPath(location.pathname + location.search);
    navigate("/settings?section=general");
  };

  const handleCloseSettings = () => {
    // If previousPath belongs to a space that's now archived, go to active space's default route
    if (previousPath) {
      const belongsToArchivedSpace =
        activeSpace && !previousPath.startsWith(sidebarConfig.defaultRoute);
      if (belongsToArchivedSpace) {
        navigate(sidebarConfig.defaultRoute, { replace: true });
      } else {
        navigate(previousPath);
      }
      setPreviousPath(null);
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
