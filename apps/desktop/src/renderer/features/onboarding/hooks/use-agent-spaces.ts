import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  useGetSpacesQuery,
  useGetAppSettingsQuery,
  useArchiveSpaceMutation,
  useUnarchiveSpaceMutation,
  useSetActiveSpaceMutation,
} from "@/lib/redux/api";
import { getSpaceDefaultRoute } from "@/lib/route-utils";
import {
  type OnboardingAgentSlug,
  isOnboardingAgentSlug,
} from "../onboarding-agents";

export function useAgentSpaces(options: { navigateOnSwitch?: boolean } = {}) {
  const { navigateOnSwitch = true } = options;
  const navigate = useNavigate();
  const { data: spaces = [] } = useGetSpacesQuery();
  const { data: appSettings } = useGetAppSettingsQuery();
  const [archiveSpace] = useArchiveSpaceMutation();
  const [unarchiveSpace] = useUnarchiveSpaceMutation();
  const [setActiveSpace] = useSetActiveSpaceMutation();

  const agentSpaces = useMemo(
    () => spaces.filter((s) => s.slug && isOnboardingAgentSlug(s.slug)),
    [spaces],
  );

  const visibleAgentCount = useMemo(
    () => agentSpaces.filter((s) => !s.isArchived).length,
    [agentSpaces],
  );

  const spacesBySlug = useMemo(() => {
    const map = new Map<OnboardingAgentSlug, { id: string; isArchived: boolean }>();
    for (const space of agentSpaces) {
      if (!isOnboardingAgentSlug(space.slug)) continue;
      map.set(space.slug, { id: space.id, isArchived: space.isArchived });
    }
    return map;
  }, [agentSpaces]);

  const toggleAgent = async (slug: OnboardingAgentSlug) => {
    const space = agentSpaces.find((s) => s.slug === slug);
    if (!space) return;

    if (space.isArchived) {
      await unarchiveSpace(space.id).unwrap();
      return;
    }

    const visible = agentSpaces.filter((s) => !s.isArchived);
    if (visible.length <= 1) return;

    const remaining = visible
      .filter((s) => s.id !== space.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    await archiveSpace(space.id).unwrap();

    const activeId = appSettings?.activeSpaceId ?? null;
    const archivingActive = activeId === space.id;
    const onlyOneLeft = remaining.length === 1;

    if (archivingActive || onlyOneLeft) {
      const target = remaining[0];
      await setActiveSpace(target.id).unwrap();
      if (navigateOnSwitch) {
        const route = getSpaceDefaultRoute(target);
        setTimeout(() => {
          navigate(route, { replace: true });
        }, 0);
      }
    }
  };

  return { agentSpaces, visibleAgentCount, spacesBySlug, toggleAgent };
}
