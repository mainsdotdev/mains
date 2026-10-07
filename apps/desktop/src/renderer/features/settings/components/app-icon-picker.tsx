import { useEffect, useState } from "react";
import { Button, Text, toast } from "@/components/ui";
import { Check } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import {
  appIconAssetPath,
  DARK_APP_ICON_ID,
  DEFAULT_APP_ICON_ID,
  LIGHT_APP_ICON_ID,
  BLUE_APP_ICON_ID,
  YELLOW_APP_ICON_ID,
  RED_APP_ICON_ID,
  PURPLE_APP_ICON_ID,
  GREEN_APP_ICON_ID,
  RISOGRAPH_ICONS,
  type AppIconId,
} from "../../../../shared/app-icons";
import { SettingsSection } from "./settings-layout";

const gridClassName = "grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-8";

/** The app icon is a local Mac preference, independent of provider themes. */
export function AppIconPicker() {
  const [selected, setSelected] = useState<AppIconId | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void window.api.app
      .getDockIcon()
      .then((response) => {
        if (!active) return;
        if (response.success) {
          setSelected(response.data);
        } else toast.error(response.error);
      })
      .catch(() => {
        if (active) toast.error("Could not load the app icon");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
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

  const renderChoice = (id: AppIconId, name: string) => {
    const active = selected === id;
    return (
      <Button
        key={id}
        variant="bare"
        aria-label={name}
        aria-pressed={active}
        disabled={loading || pending}
        onClick={() => void selectIcon(id)}
        className={cn(
          "group flex min-w-0 flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-center",
          "disabled:opacity-100",
          "hover:bg-primary-100/70 dark:hover:bg-primary-900/20",
          "focus-visible:ring-2 focus-visible:ring-accent",
          active && "bg-primary-100/70 dark:bg-primary-900/20",
        )}
      >
        <span
          className={cn(
            "relative mb-1 flex size-17 items-center justify-center rounded-[19px]  dark:ring-primary-50/10",
          )}
        >
          <img
            src={`./${appIconAssetPath(id)}`}
            alt=""
            draggable={false}
            className="size-13.75 rounded-2xl object-contain"
          />
          {active && (
            <span
              aria-hidden="true"
              className="absolute -bottom-1.5 -right-1.5 flex size-4.5 items-center justify-center rounded-full   bg-primary-950 text-primary-50 dark:bg-primary-50 dark:text-primary-950 shadow-sm"
            >
              <Check className="size-3 [&_path]:stroke-3" />
            </span>
          )}
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
      <div
        className="py-4"
        role="group"
        aria-label="App icon"
        aria-busy={loading || pending}
      >
        <section aria-labelledby="app-icon-base" className="mb-6">
          <Text
            as="h3"
            id="app-icon-base"
            size="sm"
            weight="semibold"
            className="mb-2"
          >
            Base icons
          </Text>
          <div className={gridClassName}>
            {renderChoice(DEFAULT_APP_ICON_ID, "Default")}
            {renderChoice(DARK_APP_ICON_ID, "Dark")}
            {renderChoice(LIGHT_APP_ICON_ID, "Light")}
            {renderChoice(RED_APP_ICON_ID, "Red")}
            {renderChoice(YELLOW_APP_ICON_ID, "Yellow")}
            {renderChoice(GREEN_APP_ICON_ID, "Green")}
            {renderChoice(PURPLE_APP_ICON_ID, "Purple")}
            {renderChoice(BLUE_APP_ICON_ID, "Blue")}
          </div>
        </section>

        <section aria-labelledby="app-icon-risograph">
          <Text
            as="h3"
            id="app-icon-risograph"
            size="sm"
            weight="semibold"
            className="mb-2"
          >
            Risograph
          </Text>
          <div className={gridClassName}>
            {RISOGRAPH_ICONS.map(({ id, name }) => renderChoice(id, name))}
          </div>
        </section>
      </div>
    </SettingsSection>
  );
}
