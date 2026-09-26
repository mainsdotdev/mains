import { useEffect, useState } from "react";
import {
  Button,
  Caption,
  getSegmentedTabId,
  SegmentedTabs,
  Text,
  toast,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  appIconAssetPath,
  DARK_APP_ICON_ID,
  DEFAULT_APP_ICON_ID,
  JAPANESE_GRADIENTS,
  LIGHT_APP_ICON_ID,
  UPDATES,
  type AppIconId,
} from "../../../../shared/app-icons";
import { SettingsSection } from "./settings-layout";

type GradientVariant = "inside" | "outside";

const GRADIENT_TABS: { value: GradientVariant; label: string }[] = [
  { value: "inside", label: "Inside" },
  { value: "outside", label: "Outside" },
];
const GRADIENT_TABS_ID = "app-icon-gradient-tabs";
const GRADIENT_PANEL_ID = "app-icon-gradient-panel";
const gridClassName = "grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6";
const GRADIENT_GROUPS = [
  { id: "app-icon-japanese", name: "Japanese gradients", gradients: JAPANESE_GRADIENTS },
  { id: "app-icon-updates", name: "Updates", gradients: UPDATES },
] as const;

function selectedIconLabel(id: AppIconId | null): string | null {
  if (id === DEFAULT_APP_ICON_ID) return "Original";
  if (id === DARK_APP_ICON_ID) return "Dark";
  if (id === LIGHT_APP_ICON_ID) return "Light";

  for (const group of GRADIENT_GROUPS) {
    const gradient = group.gradients.find(
      ({ inside, outside }) => id === inside || id === outside,
    );
    if (gradient) {
      return `${gradient.name} · ${group.name} · ${id === gradient.inside ? "Inside" : "Outside"}`;
    }
  }
  return null;
}

/** The app icon is a local Mac preference, independent of provider themes. */
export function AppIconPicker() {
  const [selected, setSelected] = useState<AppIconId | null>(null);
  const [gradientVariant, setGradientVariant] = useState<GradientVariant>("inside");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void window.api.app.getDockIcon().then((response) => {
      if (!active) return;
      if (response.success) {
        setSelected(response.data);
        if (GRADIENT_GROUPS.some(({ gradients }) =>
          gradients.some(({ outside }) => outside === response.data)
        )) {
          setGradientVariant("outside");
        }
      } else toast.error(response.error);
    }).catch(() => {
      if (active) toast.error("Could not load the app icon");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const selectIcon = async (id: AppIconId) => {
    if (pending || id === selected) return;
    setPending(true);
    try {
      const response = await window.api.app.setDockIcon(id);
      if (response.success) setSelected(response.data);
      else toast.error(response.error);
    } catch {
      toast.error("Could not change the app icon");
    } finally {
      setPending(false);
    }
  };

  const selectedLabel = selectedIconLabel(selected);

  const renderChoice = (id: AppIconId, name: string, variant?: GradientVariant) => {
    const active = selected === id;
    return (
      <Button
        key={id}
        variant="bare"
        aria-label={variant ? `${name}, color ${variant}` : name}
        aria-pressed={active}
        disabled={loading || pending}
        onClick={() => void selectIcon(id)}
        className={cn(
          "group flex min-w-0 flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-center",
          "hover:bg-primary-100/70 dark:hover:bg-primary-900/20",
          "focus-visible:ring-2 focus-visible:ring-accent",
          active && "bg-primary-100/70 dark:bg-primary-900/20",
        )}
      >
        <span className={cn(
          "mb-1 flex size-17 items-center justify-center rounded-[19px] ring-1 ring-primary-950/10 dark:ring-primary-50/10",
          active && "ring-2 ring-accent",
        )}>
          <img
            src={`./${appIconAssetPath(id)}`}
            alt=""
            draggable={false}
            className="size-13.75 rounded-2xl object-contain"
          />
        </span>
        <Text
          as="span"
          size="xs"
          weight={active ? "semibold" : "medium"}
          tone={active ? "default" : "secondary"}
          className="max-w-full truncate"
        >
          {name}
        </Text>
      </Button>
    );
  };

  return (
    <SettingsSection title="App icon">
      <div className="py-4" role="group" aria-label="App icon" aria-busy={loading || pending}>
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Caption>
            Choose the icon shown in the macOS Dock. Your choice is restored when Mains opens.
          </Caption>
          {selectedLabel && <Text as="span" size="xs" tone="muted">Current: {selectedLabel}</Text>}
        </div>

        <section aria-labelledby="app-icon-base" className="mb-6">
          <Text as="h3" id="app-icon-base" size="sm" weight="semibold" className="mb-2">
            Base icons
          </Text>
          <div className={gridClassName}>
            {renderChoice(DEFAULT_APP_ICON_ID, "Default")}
            {renderChoice(DARK_APP_ICON_ID, "Dark")}
            {renderChoice(LIGHT_APP_ICON_ID, "Light")}
          </div>
        </section>

        <section aria-labelledby="app-icon-gradients">
          <div className="mb-4 flex flex-wrap items-end justify-end gap-3">
            {/* <Text as="h3" id="app-icon-gradients" size="sm" weight="semibold">
              Alternative icons
            </Text> */}
            <SegmentedTabs
              id={GRADIENT_TABS_ID}
              value={gradientVariant}
              onChange={setGradientVariant}
              options={GRADIENT_TABS}
              panelId={GRADIENT_PANEL_ID}
              aria-label="Gradient color placement"
              disabled={loading}
              className="w-40"
            />
          </div>
          <div
            id={GRADIENT_PANEL_ID}
            role="tabpanel"
            aria-labelledby={getSegmentedTabId(GRADIENT_TABS_ID, gradientVariant)}
          >
            {GRADIENT_GROUPS.map(({ id, name, gradients }) => (
              <section key={id} aria-labelledby={id} className="mb-6 last:mb-0">
                <Text as="h4" id={id} size="sm" weight="semibold" className="mb-2">
                  {name}
                </Text>
                <div className={gridClassName}>
                  {gradients.map(({ name: gradientName, inside, outside }) =>
                    renderChoice(
                      gradientVariant === "inside" ? inside : outside,
                      gradientName,
                      gradientVariant,
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </section>
      </div>
    </SettingsSection>
  );
}
