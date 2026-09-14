import { useEffect, useMemo, useCallback } from "react";
import { appEvents } from "@/lib/transport";
import {
  useGetProviderModelsQuery,
  useGetProviderCommandsQuery,
  useGetProviderSkillsQuery,
  useGetProviderByIdQuery,
  useUpdateProviderMutation,
} from "@/lib/redux/api/providersApi";
import { setWorkspaceModel } from "@/lib/redux/slices/workspaceSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { dedupeModelsByPrettyName, getModelPrettyName } from "@/lib/model-icons";
import {
  getProviderVariant,
  type ProviderVariant,
} from "@/lib/provider-variants";
import { resolveEffortSelection } from "@/features/workspace/lib/resolve-effort";

export function useProviderModels(
  activeProviderId: string,
  variant: ProviderVariant,
  externalSelectedModel?: string,
  externalOnModelChange?: (model: string) => void,
  workspacePath?: string,
) {
  const dispatch = useAppDispatch();
  const caps = getProviderVariant(variant);

  const persistedModel = useAppSelector(
    (state) =>
      state.workspace.selectedModelByProvider[activeProviderId],
  );

  const {
    data: providerModels,
    isLoading: isLoadingModels,
    isFetching: isFetchingModels,
    error: modelsError,
    refetch: refetchModels,
  } = useGetProviderModelsQuery(activeProviderId, { skip: !activeProviderId });

  const { data: providerCommands = [], isLoading: isLoadingCommands } =
    useGetProviderCommandsQuery(
      { id: activeProviderId, workspacePath },
      { skip: !activeProviderId },
    );

  const { data: providerSkills = [], isLoading: isLoadingSkills } =
    useGetProviderSkillsQuery(
      { id: activeProviderId, workspacePath },
      { skip: !activeProviderId || !caps.supportsSkills },
    );

  const { data: providerData } = useGetProviderByIdQuery(activeProviderId, {
    skip: variant !== "claude" && variant !== "codex" && variant !== "copilot" && variant !== "cursor",
  });
  const [updateProvider] = useUpdateProviderMutation();
  const config = (providerData?.config ?? {}) as Record<string, any>;

  const permissionMode: string = config[caps.permissionKey] ?? caps.permissionDefault;
  const thinkingMode = caps.thinkingCoupledToEffort
    ? !!config.modelReasoningEffort
    : !!config.thinkingMode;
  // Codex maps "fast mode" to its "fast" service tier (canonical id from
  // model/list; Codex's request_value forwards it to OpenAI as "priority").
  // Accept both ids so it stays consistent with whatever the Settings dropdown
  // persists, and so legacy installs that stored "priority" still register.
  const fastMode = caps.fastMode.kind === "serviceTier"
    ? caps.fastMode.match.includes((config[caps.fastMode.key] as string) ?? "")
    : !!config[caps.fastMode.key];
  // ultracode is a Claude-only boolean flag (xhigh + dynamic-workflow
  // orchestration). It's the single source of truth; the displayed effort
  // level is folded to "ultracode" so the dropdown shows it as selected.
  const ultracode = caps.supportsUltracode && !!config.ultracode;
  const effortLevel: string = !caps.thinkingCoupledToEffort && ultracode
    ? "ultracode"
    : config[caps.effortKey] || "";
  const planMode: boolean = caps.supportsPlanMode && !!config.planMode;
  const goalMode: boolean = caps.supportsGoalMode && !!config.goalMode;

  const handlePermissionModeChange = useCallback(async (mode: string) => {
    if (!providerData) return;
    const currentConfig = providerData.config ?? {};
    const configKey = caps.permissionKey;
    await updateProvider({
      id: activeProviderId,
      payload: {
        config: {
          ...currentConfig,
          [configKey]: mode,
        },
      },
    });
  }, [providerData, activeProviderId, caps, updateProvider]);

  const handlePlanModeToggle = useCallback(async () => {
    if (!providerData) return;
    const currentConfig = providerData.config ?? {};
    await updateProvider({
      id: activeProviderId,
      payload: {
        config: {
          ...currentConfig,
          planMode: !planMode,
        },
      },
    });
  }, [providerData, planMode, activeProviderId, updateProvider]);

  const handleGoalModeToggle = useCallback(async () => {
    if (!providerData) return;
    const currentConfig = providerData.config ?? {};
    const enabling = !goalMode;
    await updateProvider({
      id: activeProviderId,
      payload: {
        config: {
          ...currentConfig,
          goalMode: !goalMode,
          // Goal and plan modes are mutually exclusive — turning goal on clears plan.
          ...(enabling ? { planMode: false } : {}),
        },
      },
    });
  }, [providerData, goalMode, activeProviderId, updateProvider]);

  const handleThinkingModeToggle = useCallback(async () => {
    if (!providerData) return;
    const currentConfig = providerData.config ?? {};
    const enabling = !thinkingMode;
    await updateProvider({
      id: activeProviderId,
      payload: {
        config: {
          ...currentConfig,
          thinkingMode: enabling,
          // ultracode means xhigh, which the API rejects outright when thinking
          // is disabled. Leaving it set here is what produced "effort 'xhigh'
          // is not supported when thinking is disabled on this model" — turning
          // thinking off has to clear the effort selection with it.
          ...(enabling ? {} : { ultracode: false, [caps.effortKey]: undefined }),
        },
      },
    });
  }, [providerData, thinkingMode, activeProviderId, updateProvider, caps]);

  const handleFastModeToggle = useCallback(async () => {
    if (!providerData) return;
    const currentConfig = providerData.config ?? {};
    // Codex toggles the "fast" service tier on/off (canonical id from
    // model/list); other variants keep the simple boolean.
    const patch: Record<string, unknown> = caps.fastMode.kind === "serviceTier"
      ? { [caps.fastMode.key]: fastMode ? undefined : caps.fastMode.on }
      : { [caps.fastMode.key]: !fastMode };
    await updateProvider({
      id: activeProviderId,
      payload: {
        config: {
          ...currentConfig,
          ...patch,
        },
      },
    });
  }, [providerData, fastMode, activeProviderId, updateProvider, caps]);

  const handleEffortLevelChange = useCallback(async (level: string) => {
    if (!providerData) return;
    const currentConfig = providerData.config ?? {};
    let patch: Record<string, unknown>;
    if (caps.thinkingCoupledToEffort) {
      // Codex/Copilot store the effort directly; thinking is inferred from it.
      // `thinkingMode` still rides along as the record of intent — without it,
      // clearing the level is indistinguishable from never having chosen one
      // and the clamp effect seeds the default straight back.
      patch = { [caps.effortKey]: level || undefined, thinkingMode: !!level };
    } else if (caps.supportsUltracode && level === "ultracode") {
      // ultracode is stored as a boolean. It implies xhigh + workflow
      // orchestration, so clear effortLevel and let the driver send it via
      // settings.ultracode instead of options.effort.
      patch = { thinkingMode: true, ultracode: true, effortLevel: undefined };
    } else {
      // Claude/Cursor use thinkingMode + effortLevel. Any non-ultracode
      // selection (including "Off") turns ultracode back off.
      patch = { thinkingMode: !!level, effortLevel: level || undefined, ultracode: false };
    }
    await updateProvider({
      id: activeProviderId,
      payload: { config: { ...currentConfig, ...patch } },
    });
  }, [providerData, activeProviderId, updateProvider, caps]);

  const selectableModels = useMemo(
    () => dedupeModelsByPrettyName(providerModels ?? [], variant),
    [providerModels, variant],
  );

  const modelDisplayNames = useMemo(
    () => selectableModels.map((m) => getModelPrettyName(m, variant)),
    [selectableModels, variant],
  );

  const modelEffortLevelsByDisplayName = useMemo(
    () =>
      Object.fromEntries(
        selectableModels.map((model) => [
          getModelPrettyName(model, variant),
          model.supportedEffortLevels,
        ]),
      ),
    [selectableModels, variant],
  );

  const selectedModel = externalSelectedModel ?? persistedModel ?? "";
  const setSelectedModel = useCallback(
    (model: string) => {
      externalOnModelChange?.(model);
      dispatch(setWorkspaceModel({ providerId: activeProviderId, model }));
    },
    [externalOnModelChange, dispatch, activeProviderId],
  );

  const selectedModelDisplayName = useMemo(() => {
    if (providerModels) {
      const model = providerModels.find((m) => m.id === selectedModel);
      return model ? getModelPrettyName(model, variant) : selectedModel;
    }
    return "";
  }, [providerModels, selectedModel, variant]);

  const selectedModelInfo = useMemo(() => {
    if (providerModels) {
      return providerModels.find((m) => m.id === selectedModel) ?? null;
    }
    return null;
  }, [providerModels, selectedModel]);

  useEffect(() => {
    if (!providerModels || providerModels.length === 0) return;
    const selectCatalogDefault = () => {
      const defaultModel =
        providerModels.find((m) => m.isDefault) ?? providerModels[0];
      setSelectedModel(defaultModel.id);
    };
    if (!selectedModel) {
      selectCatalogDefault();
      return;
    }
    // The pick is persisted (localStorage) indefinitely, but providers rotate
    // their catalogs every few months and retired ids drop off `listModels`.
    // Re-anchor on the live default instead of sending a dead id to the CLI.
    // Guarded on a settled fetch so an auth failure or an in-flight refetch
    // can't clobber a still-valid selection.
    if (isFetchingModels || modelsError) return;
    if (!providerModels.some((m) => m.id === selectedModel)) selectCatalogDefault();
  }, [providerModels, selectedModel, setSelectedModel, isFetchingModels, modelsError]);

  // Background model-capability discovery (e.g. Cursor per-model effort levels)
  // runs after the initial fast model list returns; refetch to pick up the
  // enriched metadata when the main process signals it's ready.
  useEffect(() => {
    const off = appEvents.providers.onModelsUpdated(({ providerId }) => {
      if (providerId === activeProviderId) refetchModels();
    });
    return () => {
      off();
    };
  }, [activeProviderId, refetchModels]);

  // Clamp effort level when switching to a model that doesn't support the
  // current level. The rules live in resolveEffortSelection; this effect only
  // applies the verdict.
  //
  // `thinkingDisabled` reads the *raw* stored flag rather than the derived
  // `thinkingMode` above: for the coupled variants that value is inferred from
  // the effort level itself, so it reads false whenever nothing is stored and
  // would block the very seeding this effect exists to do.
  useEffect(() => {
    if (!selectedModelInfo) return;
    const resolution = resolveEffortSelection({
      supportedEffortLevels: selectedModelInfo.supportedEffortLevels,
      effortLevel,
      ultracode,
      thinkingDisabled: config.thinkingMode === false,
      effortDefault: caps.effortDefault,
    });
    if (resolution) handleEffortLevelChange(resolution.effortLevel);
  }, [
    selectedModelInfo,
    effortLevel,
    ultracode,
    config.thinkingMode,
    handleEffortLevelChange,
    caps,
  ]);

  const handleModelChange = useCallback(
    (prettyName: string) => {
      const model = selectableModels.find((m) => getModelPrettyName(m, variant) === prettyName);
      if (model) {
        setSelectedModel(model.id);
        return;
      }
      setSelectedModel(prettyName);
    },
    [selectableModels, setSelectedModel, variant],
  );

  return {
    selectedModel,
    selectedModelDisplayName,
    modelDisplayNames,
    modelEffortLevelsByDisplayName,
    isLoadingModels,
    isFetchingModels,
    handleModelChange,
    providerCommands,
    isLoadingCommands,
    providerSkills,
    isLoadingSkills,
    modelsError,
    refetchModels,
    permissionMode,
    handlePermissionModeChange,
    thinkingMode,
    handleThinkingModeToggle,
    fastMode,
    handleFastModeToggle,
    effortLevel,
    handleEffortLevelChange,
    supportsUltracode:
      caps.supportsUltracode &&
      !!selectedModelInfo?.supportedEffortLevels?.includes("xhigh" as any),
    selectedModelInfo,
    planMode,
    handlePlanModeToggle,
    goalMode,
    handleGoalModeToggle,
  };
}
