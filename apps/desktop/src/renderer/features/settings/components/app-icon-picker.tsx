import { useEffect, useState } from "react";
import { Button, toast } from "@/components/ui";
import { Check } from "@/components/ui/icons";
import {
  appIconAssetPath,
  ATLAS_APP_ICON_ID,
  DEFAULT_APP_ICON_ID,
  type AppIconId,
} from "../../../../shared/app-icons";
import { SettingsRow, SettingsSection } from "./settings-layout";

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
        tooltip={name}
        aria-pressed={active}
        disabled={loading || pending}
        onClick={() => void selectIcon(id)}
        className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl disabled:opacity-100 enabled:hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <img
          src={`./${appIconAssetPath(id)}`}
          alt=""
          draggable={false}
          className="size-12 object-contain"
        />
        {active && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 right-0 flex size-3.5 items-center justify-center rounded-full bg-primary-950 text-primary-50 dark:bg-primary-50 dark:text-primary-950"
          >
            <Check className="size-2.5 [&_path]:stroke-3" />
          </span>
        )}
      </Button>
    );
  };

  return (
    <SettingsSection>
      <SettingsRow
        title="Dock icon"
        description="Customize how Mains appears in your Dock"
      >
        <div
          className="flex items-center gap-3"
          role="group"
          aria-label="Dock icon"
          aria-busy={loading || pending}
        >
          {renderChoice(DEFAULT_APP_ICON_ID, "Default")}
          {renderChoice(ATLAS_APP_ICON_ID, "Atlas")}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
