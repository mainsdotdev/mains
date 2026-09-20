import { useState } from "react";
import { Button, Input, Select, Text } from "@/components/ui";
import { Close, RotateDevice } from "@/components/ui/icons";
import type { SelectOption } from "@/components/ui";
import type {
  BrowserDeviceEmulationViewModel,
  BrowserDevicePresetId,
} from "./browser-tab-strip";

interface DevicePreset {
  id: BrowserDevicePresetId;
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
}

const DEVICE_PRESETS: DevicePreset[] = [
  { id: "responsive", label: "Responsive", width: 393, height: 852, deviceScaleFactor: 2 },
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667, deviceScaleFactor: 2 },
  { id: "iphone-14-pro", label: "iPhone 14 Pro", width: 393, height: 852, deviceScaleFactor: 3 },
  { id: "iphone-14-pro-max", label: "iPhone 14 Pro Max", width: 430, height: 932, deviceScaleFactor: 3 },
  { id: "pixel-7", label: "Pixel 7", width: 412, height: 915, deviceScaleFactor: 3 },
  { id: "galaxy-s20-ultra", label: "Galaxy S20 Ultra", width: 412, height: 915, deviceScaleFactor: 3 },
  { id: "surface-duo", label: "Surface Duo", width: 540, height: 720, deviceScaleFactor: 2 },
  { id: "ipad-mini", label: "iPad mini", width: 768, height: 1_024, deviceScaleFactor: 2 },
  { id: "ipad-air", label: "iPad Air", width: 820, height: 1_180, deviceScaleFactor: 2 },
  { id: "nest-hub", label: "Nest Hub", width: 1_024, height: 600, deviceScaleFactor: 2 },
];

const DEVICE_OPTIONS: SelectOption<BrowserDevicePresetId>[] = DEVICE_PRESETS.map(
  (preset) => ({
    value: preset.id,
    label: preset.label,
    description: `${preset.width} × ${preset.height}`,
  }),
);

const SCALE_VALUES = ["0.5", "0.75", "0.84", "1", "1.25", "1.5", "2"] as const;
type DeviceScaleValue = (typeof SCALE_VALUES)[number];

const SCALE_OPTIONS: SelectOption<DeviceScaleValue>[] = SCALE_VALUES.map(
  (value) => ({
    value,
    label: `${Math.round(Number(value) * 100)}%`,
  }),
);

function clampDimension(value: string, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

interface BrowserDeviceToolbarProps {
  device: BrowserDeviceEmulationViewModel;
  onChange: (device: BrowserDeviceEmulationViewModel) => void;
  onClose: () => void;
  onDropdownOpenChange?: (id: "device" | "scale", open: boolean) => void;
}

interface DeviceDimensionInputProps {
  value: number;
  minimum: number;
  label: string;
  onCommit: (value: number) => void;
}

function DeviceDimensionInput({
  value,
  minimum,
  label,
  onCommit,
}: DeviceDimensionInputProps) {
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const next = clampDimension(draft, minimum, 2_560);
    if (next === null) {
      setDraft(String(value));
      return;
    }
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  const nudge = (delta: number) => {
    const current = clampDimension(draft, minimum, 2_560) ?? value;
    const next = Math.min(2_560, Math.max(minimum, current + delta));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div className="group relative h-8 w-16 shrink-0">
      <Input
        variant="bare"
        type="number"
        min={minimum}
        max={2_560}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        aria-label={label}
        className="glass-input h-full w-full appearance-none rounded-xl pl-2 pr-5 text-center text-xs font-semibold tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <div className="pointer-events-none absolute bottom-1 right-1 top-1 flex w-4 flex-col overflow-hidden rounded-md border border-primary-200/80 bg-primary-100/95 text-primary-700 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 dark:border-primary-700/80 dark:bg-primary-900/95 dark:text-primary-300">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Increase ${label.toLowerCase()}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => nudge(1)}
          className="flex flex-1 items-center justify-center border-b border-primary-200/80 transition-colors hover:bg-primary-200/80 hover:text-primary-950 active:bg-primary-300/80 dark:border-primary-700/80 dark:hover:bg-primary-800/90 dark:hover:text-primary-50 dark:active:bg-primary-700/80"
        >
          <span className="size-0 border-x-[3px] border-b-4 border-x-transparent border-b-current" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Decrease ${label.toLowerCase()}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => nudge(-1)}
          className="flex flex-1 items-center justify-center transition-colors hover:bg-primary-200/80 hover:text-primary-950 active:bg-primary-300/80 dark:hover:bg-primary-800/90 dark:hover:text-primary-50 dark:active:bg-primary-700/80"
        >
          <span className="size-0 border-x-[3px] border-t-4 border-x-transparent border-t-current" />
        </button>
      </div>
    </div>
  );
}

export function BrowserDeviceToolbar({
  device,
  onChange,
  onClose,
  onDropdownOpenChange,
}: BrowserDeviceToolbarProps) {
  const updateDimension = (axis: "width" | "height", next: number) => {
    onChange({ ...device, presetId: "responsive", [axis]: next });
  };
  const scaleValue = String(device.scale) as DeviceScaleValue;

  return (
    <div
      className="flex min-h-11 items-center gap-2 overflow-x-auto border-b border-primary-200/50 bg-primary-50/45 px-2.5 py-1.5 dark:border-primary-800/45 dark:bg-primary-950/35"
      role="toolbar"
      aria-label="Device emulation"
    >
      <Text
        as="span"
        size="xs"
        weight="medium"
        className="shrink-0 text-primary-800 dark:text-primary-200"
      >
        Dimensions:
      </Text>

      <div className="w-42 shrink-0 [&>div>button]:h-8 [&>div>button]:min-w-0 [&>div>button]:px-2.5 [&>div>button]:py-0">
        <Select
          size="sm"
          value={device.presetId}
          options={DEVICE_OPTIONS}
          onChange={(presetId) => {
            const preset = DEVICE_PRESETS.find((item) => item.id === presetId);
            if (!preset) return;
            onChange({
              ...device,
              presetId: preset.id,
              width: preset.width,
              height: preset.height,
              deviceScaleFactor: preset.deviceScaleFactor,
            });
          }}
          onOpenChange={(open) => onDropdownOpenChange?.("device", open)}
          aria-label="Device preset"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <DeviceDimensionInput
          key={`width-${device.width}`}
          value={device.width}
          minimum={200}
          label="Viewport width"
          onCommit={(value) => updateDimension("width", value)}
        />
        <Text as="span" size="sm" tone="subtle" aria-hidden="true">
          ×
        </Text>
        <DeviceDimensionInput
          key={`height-${device.height}`}
          value={device.height}
          minimum={300}
          label="Viewport height"
          onCommit={(value) => updateDimension("height", value)}
        />
      </div>

      <Button
      variant="icon"
        onClick={() =>
          onChange({
            ...device,
            presetId: "responsive",
            width: Math.min(2_560, Math.max(200, device.height)),
            height: Math.min(2_560, Math.max(300, device.width)),
          })
        }
        tooltip="Rotate device"
        tooltipPosition="bottom"
        aria-label="Rotate device"
        className="p-1.5!"
      >
        <RotateDevice className="size-4" />
      </Button>

      <div className="w-21 shrink-0 [&>div>button]:h-8 [&>div>button]:min-w-0 [&>div>button]:px-2.5 [&>div>button]:py-0">
        <Select
          size="sm"
          value={scaleValue}
          options={SCALE_OPTIONS}
          onChange={(value) => onChange({ ...device, scale: Number(value) })}
          onOpenChange={(open) => onDropdownOpenChange?.("scale", open)}
          aria-label="Device display scale"
        />
      </div>

      <Button
      variant="icon"
        onClick={onClose}
        tooltip="Close device toolbar"
        tooltipPosition="bottom-left"
        aria-label="Close device toolbar"
        className="ml-auto shrink-0 "
      >
        <Close className="size-3.5" />
      </Button>
    </div>
  );
}
