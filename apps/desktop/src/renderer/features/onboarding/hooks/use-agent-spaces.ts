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
  type OnboardingAgentId,
  isOnboardingAgentId,
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
    () => spaces.filter((s) => isOnboardingAgentId(s.id)),
    [spaces],
  );

  const visibleAgentCount = useMemo(
    () => agentSpaces.filter((s) => !s.isArchived).length,
    [agentSpaces],
  );

  const spacesById = useMemo(() => {
    const map = new Map<OnboardingAgentId, { id: string; isArchived: boolean }>();
    for (const space of agentSpaces) {
      if (!isOnboardingAgentId(space.id)) continue;
      map.set(space.id, { id: space.id, isArchived: space.isArchived });
    }
    return map;
  }, [agentSpaces]);

  const toggleAgent = async (id: OnboardingAgentId) => {
    const space = agentSpaces.find((s) => s.id === id);
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

  return { agentSpaces, visibleAgentCount, spacesById, toggleAgent };
}
