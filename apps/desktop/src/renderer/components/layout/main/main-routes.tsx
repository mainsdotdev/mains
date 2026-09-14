import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Home from "@/routes/Home";
import { useSidebarConfig } from "@/hooks/use-sidebar-config";
import { useModeConfig } from "@/hooks/use-mode-config";
import { useActiveSpace } from "@/hooks/use-active-space";
import CodePage from "@/routes/Code";

// Off the boot path (`/` lands on the workspace page, so it stays eager).
// Loading these lazily keeps their feature graphs out of the startup script
// eval.
const Settings = lazy(() => import("@/routes/Settings"));
const PluginsPage = lazy(() => import("@/routes/Plugins"));
const Pulse = lazy(() => import("@/routes/Pulse"));
const Relay = lazy(() => import("@/routes/Relay"));
const Tasks = lazy(() => import("@/routes/Tasks"));

function DefaultRoute() {
  const { activeSpace } = useActiveSpace();
  const sidebarConfig = useSidebarConfig();

  if (!activeSpace) return null;

  if (sidebarConfig.defaultRoute !== "/") {
    return <Navigate to={sidebarConfig.defaultRoute} replace />;
  }

  return <Home />;
}

/**
 * `/tasks` exists only in the modes whose sidebar offers it. Switching mode
 * while the page is open (mode picker, ⌘1/2/3, or a space switch) would leave
 * it mounted with no nav entry pointing back at it — hand the user the new
 * mode's default route instead.
 */
function TasksRoute() {
  const { activeSpace } = useActiveSpace();
  const { showTasksNav, sidebar } = useModeConfig();

  if (!activeSpace) return null;
  if (!showTasksNav) return <Navigate to={sidebar.defaultRoute} replace />;

  return <Tasks />;
}

export function MainRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<DefaultRoute />} />
        <Route path="/code" element={<CodePage />} />
        <Route path="/code/runs/:runId" element={<CodePage />} />
        <Route path="/code/:workspaceId" element={<CodePage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/plugins" element={<PluginsPage />} />
        <Route path="/pulse" element={<Pulse />} />
        <Route path="/relay" element={<Relay />} />
        <Route path="/tasks" element={<TasksRoute />} />
      </Routes>
    </Suspense>
  );
}
