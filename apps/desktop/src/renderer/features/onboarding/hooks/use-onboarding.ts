import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  appSettingsApi,
  useGetAppSettingsQuery,
  useUpdateAppSettingsMutation,
} from "@/lib/redux/api/appSettingsApi";
import { useGetSpacesQuery } from "@/lib/redux/api/spaceApi";
import {
  useDetectInstalledClisQuery,
  useGetEnabledProvidersQuery,
} from "@/lib/redux/api/providersApi";
import {
  setOnboardingCompleted,
  setTheme,
  setThemeChoice,
} from "@/lib/redux/slices/appSettingsSlice";
import { getSpaceDefaultRoute } from "@/lib/route-utils";
import type { ProviderVariant } from "@/lib/provider-variants";
import type { ThemeAppearance } from "@/lib/app-themes";
import {
  chooseOnboardingPreset,
  initialProvider,
  onboardingProviders,
  onboardingSettingsPatch,
} from "../lib/onboarding-state";
import { revealOnboardingWorkspace } from "../lib/onboarding-completion";

const ALL_ONBOARDING_STEPS = [
  "welcome",
  "providers",
  "theme",
  "worktrees",
  "notifications",
  "ready",
] as const;
export type OnboardingStepId = (typeof ALL_ONBOARDING_STEPS)[number];

// Keep the final card available until its content is ready.
const SHOW_READY_STEP = false;
export const ONBOARDING_STEPS = ALL_ONBOARDING_STEPS.filter(
  (step) => step !== "ready" || SHOW_READY_STEP,
);

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";
const systemIsDark = () => window.matchMedia(SYSTEM_DARK_QUERY).matches;
const subscribeAppearance = (callback: () => void) => {
  const media = window.matchMedia(SYSTEM_DARK_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};

/** Draft all choices locally. Only Finish changes persisted settings. */
export function useOnboarding(beforeComplete?: () => Promise<void>) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const savedTheme = useAppSelector((state) => state.appSettings.theme);
  const savedPalettes = useAppSelector(
    (state) => state.appSettings.appTheme.default,
  );
  const settingsQuery = useGetAppSettingsQuery();
  const spacesQuery = useGetSpacesQuery();
  const providersQuery = useGetEnabledProvidersQuery();
  const cliQuery = useDetectInstalledClisQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  const [updateSettings, { isLoading: isSaving }] =
    useUpdateAppSettingsMutation();
  const saving = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [{ index: storedIndex, direction }, setStep] = useState({
    index: 0,
    direction: 1,
  });
  // Retained step state can point past the end after an optional step is hidden.
  const index = Math.min(storedIndex, ONBOARDING_STEPS.length - 1);
  // undefined means untouched; null is the user's explicit "Set up later".
  const [providerChoice, setProviderChoice] = useState<
    ProviderVariant | null | undefined
  >();
  const [theme, changeTheme] = useState(savedTheme);
  const [palettes, changePalettes] = useState(savedPalettes);
  const [enableWorktrees, changeWorktrees] = useState(false);
  const [notifications, changeNotifications] = useState<boolean>();
  const osDark = useSyncExternalStore(
    subscribeAppearance,
    systemIsDark,
    () => false,
  );
  const appearance: ThemeAppearance =
    theme === "dark" || (theme === "system" && osDark) ? "dark" : "light";
  const options = onboardingProviders(
    providersQuery.data ?? [],
    spacesQuery.data ?? [],
    cliQuery.isError ? undefined : cliQuery.data,
    settingsQuery.data?.activeSpaceId ?? null,
  );
  const selectedProvider =
    providerChoice === undefined
      ? initialProvider(options, settingsQuery.data?.activeSpaceId ?? null)
      : providerChoice;
  const selectedOption =
    options.find(
      (option) => option.variant === selectedProvider && option.available,
    ) ?? null;
  const providerSkipped = providerChoice === null;
  const notifyOnRunComplete =
    notifications ?? settingsQuery.data?.notifyOnRunComplete ?? false;
  const step = ONBOARDING_STEPS[index];
  const isLastStep = index === ONBOARDING_STEPS.length - 1;
  const canContinue =
    !isSaving &&
    !isCompleting &&
    (isLastStep
      ? !!settingsQuery.data &&
        !!spacesQuery.data &&
        (providerSkipped || !!selectedOption)
      : step === "providers"
        ? !!selectedOption
        : step === "worktrees" || step === "notifications"
          ? !!settingsQuery.data
          : true);
  const providerError =
    cliQuery.isError || spacesQuery.isError || providersQuery.isError;
  const isDetecting =
    cliQuery.isFetching || spacesQuery.isLoading || providersQuery.isLoading;
  const { refetch: refetchClis } = cliQuery;
  const { refetch: refetchSpaces } = spacesQuery;
  const { refetch: refetchProviders } = providersQuery;

  const recheckProviders = useCallback(() => {
    void refetchClis();
    void refetchSpaces();
    void refetchProviders();
  }, [refetchClis, refetchSpaces, refetchProviders]);

  useEffect(() => {
    const recheck = () => {
      if (step === "providers") recheckProviders();
    };
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [step, recheckProviders]);

  const goTo = (next: number) => {
    if (saving.current || isCompleting || next < 0 || next >= ONBOARDING_STEPS.length) return;
    setSaveError(null);
    setStep({ index: next, direction: next > index ? 1 : -1 });
  };

  const finish = async () => {
    if (
      saving.current ||
      !canContinue ||
      !settingsQuery.data ||
      !spacesQuery.data
    )
      return;
    saving.current = true;
    setSaveError(null);
    try {
      const patch = onboardingSettingsPatch(
        settingsQuery.data,
        spacesQuery.data,
        selectedOption,
        { enableWorktrees, notifyOnRunComplete },
      );
      const saved = await updateSettings(patch).unwrap();
      setIsCompleting(true);
      // Mount the shell with the committed provider, before the invalidated
      // query refetches. A failed save never marks onboarding complete.
      dispatch(
        appSettingsApi.util.updateQueryData(
          "getAppSettings",
          undefined,
          () => saved,
        ),
      );
      await beforeComplete?.();
      revealOnboardingWorkspace(() => {
        dispatch(
          setThemeChoice({
            providerId: null,
            appearance: "light",
            choice: palettes.light,
          }),
        );
        dispatch(
          setThemeChoice({
            providerId: null,
            appearance: "dark",
            choice: palettes.dark,
          }),
        );
        dispatch(setTheme(theme));
        const space = spacesQuery.data!.find(
          (candidate) => candidate.id === saved.activeSpaceId,
        );
        navigate(space ? getSpaceDefaultRoute(space) : "/", { replace: true });
        dispatch(setOnboardingCompleted(true));
      });
    } catch {
      setIsCompleting(false);
      setSaveError(
        "Couldn’t save your setup. Your choices are still here — try again.",
      );
    } finally {
      saving.current = false;
    }
  };

  return {
    index,
    direction,
    step,
    isLastStep,
    canContinue,
    isSaving: isSaving || isCompleting,
    isCompleting,
    saveError,
    goBack: () => goTo(index - 1),
    goNext: () => {
      if (!canContinue) return;
      if (step === "providers") setProviderChoice(selectedProvider);
      if (isLastStep) void finish();
      else goTo(index + 1);
    },
    skipProvider: () => {
      setProviderChoice(null);
      goTo(index + 1);
    },
    chooseProvider: setProviderChoice,
    selectedProvider,
    options,
    isDetecting,
    providerError,
    recheckProviders,
    settingsReady: !!settingsQuery.data,
    settingsError: settingsQuery.isError || spacesQuery.isError,
    retrySettings: () => {
      void settingsQuery.refetch();
      void spacesQuery.refetch();
    },
    returnToProviders: () => goTo(1),
    providerNeedsAttention: isLastStep && !providerSkipped && !selectedOption,
    theme,
    changeTheme,
    palettes,
    appearance,
    choosePreset: (id: string) =>
      changePalettes((choice) =>
        chooseOnboardingPreset(choice, id, appearance),
      ),
    enableWorktrees,
    changeWorktrees,
    notifyOnRunComplete,
    changeNotifications,
  };
}
