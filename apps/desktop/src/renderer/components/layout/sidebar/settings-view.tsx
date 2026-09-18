import { useNavigate, useLocation } from "react-router-dom";
import { Body, Button, Text } from "@/components/ui";
import { ChevronUp, ProjectFolder } from "@/components/ui/icons";
import {
  useGetAccountQuery,
  useListCollectionsQuery,
  useListProjectsQuery,
} from "@/lib/redux/api";
import { useAppDispatch } from "@/lib/redux/hooks";
import { setSidebarCollapsed } from "@/lib/redux/slices/appSettingsSlice";
import { useIsMobile } from "@/lib/platform";
import { iconTintClass, parseIcon, type IconComponent } from "@/lib/icon-registry";
import {
  getSettingsRouteId,
  isSettingsNavItemActive,
  SETTINGS_MAIN_NAV_ITEMS,
  type SettingsRouteId,
} from "@/features/settings/settings-sections";
import { useActiveSpace } from "@/hooks/use-active-space";

interface SettingsViewProps {
  onClose: () => void;
}

export default function SettingsView({ onClose }: SettingsViewProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const isMobile = useIsMobile();
  const { activeSpace } = useActiveSpace();
  const showCollections = activeSpace?.mode !== "developer";

  // The settings nav lives in the sidebar; on mobile that's an overlay drawer, so
  // close it after picking a section/project to reveal the content underneath.
  const goTo = (url: string) => {
    navigate(url);
    if (isMobile) dispatch(setSidebarCollapsed(true));
  };

  const isOnSettingsPage = location.pathname === "/settings";
  const searchParams = new URLSearchParams(location.search);
  const activeSection = getSettingsRouteId(searchParams.get("section"));
  const activeId = searchParams.get("id");

  const { data: account } = useGetAccountQuery();
  const { data: codeProjects = [] } = useListProjectsQuery(undefined, {
    skip: showCollections,
  });
  const { data: collections = [] } = useListCollectionsQuery(
    { accountId: account?.id ?? "" },
    { skip: !showCollections || !account?.id },
  );
  const projects = showCollections
    ? collections.filter((collection) => !collection.isArchived)
    : codeProjects;
  const projectKind = showCollections ? "collection" : "code";

  const handleSectionClick = (sectionId: SettingsRouteId) => {
    goTo(`/settings?section=${sectionId}`);
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        animation: "slide-fade-down 200ms cubic-bezier(0.23, 1, 0.32, 1)",
      }}
    >
      <div className="flex flex-col items-start pt-12 pb-1 px-4">
        <Body align="left">Settings</Body>
      </div>

      <div className="flex-1 px-3 mb-1 mt-2 overflow-y-auto noscrollbar">
        <nav className="space-y-0.5">
          {SETTINGS_MAIN_NAV_ITEMS.map((item) => {
            const IconComponent = item.icon;
            const isActive = isOnSettingsPage && isSettingsNavItemActive(item, activeSection);
            return (
              <Button
                key={item.id}
                onClick={() => handleSectionClick(item.id)}
                className={`w-full cursor-pointer text-left px-3 py-1.5 rounded-xl text-sm  transition-all flex items-center gap-2
                  ${
                    isActive
                      ? " glass-outline bg-primary/80 dark:bg-primary/5 text-primary-900 dark:text-primary-100"
                      : "text-primary-800 dark:text-primary-200 bg-transparent hover:bg-primary/50 dark:hover:bg-primary/5"
                  }
                  `}
              >
                {IconComponent ? (
                  <IconComponent className={`size-3.5 `} />
                ) : (
                  <div className="size-4 rounded bg-primary-300 dark:bg-primary-700" />
                )}
                <span className="">{item.label}</span>
              </Button>
            );
          })}
        </nav>

        {/* Projects section */}
        {projects.length > 0 && (
          <div className="mt-2">
            <div className="px-3 mb-1">
              <Text as="span" size="xs">
                Projects
              </Text>
            </div>
            <div className="space-y-0.5">
              {projects.map((project) => {
                const isActive =
                  isOnSettingsPage &&
                  activeSection === "projects" &&
                  activeId === project.id;
                const parsed = project.icon ? parseIcon(project.icon) : null;
                let iconContent: React.ReactNode;
                if (parsed && parsed.type === "icon") {
                  const IconComp = parsed.value as IconComponent;
                  iconContent = (
                    <IconComp className={`size-4 ${iconTintClass(parsed.color)}`} />
                  );
                } else if (parsed && parsed.type === "emoji") {
                  iconContent = (
                    <span className="text-sm leading-none">
                      {parsed.value as string}
                    </span>
                  );
                } else {
                  iconContent = <ProjectFolder className="size-3.5" />;
                }
                return (
                  <Button
                    key={project.id}
                    onClick={() =>
                      goTo(
                        `/settings?section=projects&kind=${projectKind}&id=${encodeURIComponent(project.id)}`,
                      )
                    }
                    className={`w-full cursor-pointer text-left px-3 py-1.5 rounded-xl text-sm transition-all flex items-center gap-2
                      ${
                        isActive
                          ? " glass-outline bg-primary/80 dark:bg-primary/5 text-primary-900 dark:text-primary-100"
                          : "text-primary-800 dark:text-primary-200 bg-transparent hover:bg-primary/50 dark:hover:bg-primary/5"
                      }
                      `}
                  >
                    <div className="size-4 rounded-md flex items-center justify-center text-t text-primary-900 dark:text-primary-100 shrink-0">
                      {iconContent}
                    </div>
                    <span className="truncate ">{project.name}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div
        className="px-2 mb-2.5 group animate-slide-up shrink-0"
        style={{
          animation: `slide-from-bottom 0.2s ease-out 0.1s both`,
        }}
      >
        <Button
          tooltip={"Close settings"}
          variant="bare"
          tooltipPosition="top-right"
          onClick={onClose}
          fullWidth
          className="shrink-0 max-w-18 justify-start  rounded-full flex items-center cursor-pointer px-2 py-1 gap-1 bg-transparent dark:bg-transparent transition-transform duration-200"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <ChevronUp className="size-4 rotate-270 text-primary-900 dark:text-primary-100" />
          <Text as="span" size="s" weight="normal">
            Back
          </Text>
        </Button>
      </div>
    </div>
  );
}
