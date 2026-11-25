export type VisualizationValue = string | number | boolean;

interface ControlBase {
  id: string;
  label: string;
  reference?: string;
}

export type VisualizationDesignControl = ControlBase & (
  | { type: "range"; value: number; initialValue: number; min: number; max: number; step: number; unit?: string }
  | { type: "color"; value: string; initialValue: string }
  | { type: "toggle"; value: boolean; initialValue: boolean }
  | { type: "select"; value: string; initialValue: string; options: Array<{ label: string; value: string }> }
);

export interface VisualizationControlGroup {
  id: string;
  label: string;
  variant?: string;
  visible: boolean;
  controls: VisualizationDesignControl[];
}

export interface VisualizationCarousel {
  id: string;
  label: string;
  previousLabel: string;
  nextLabel: string;
  selectedId: string;
  variants: Array<{ id: string; label: string }>;
}

export interface VisualizationControls {
  language: "en" | "tr";
  carousels: VisualizationCarousel[];
  groups: VisualizationControlGroup[];
  previewing: boolean;
}

export type VisualizationCommand =
  | { type: "select-variant"; carouselId: string; variantId: string }
  | { type: "set-control"; groupId: string; controlId: string; value: VisualizationValue }
  | { type: "preview-original"; active: boolean }
  | { type: "reset" };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function uniqueIds(items: Array<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function control(value: unknown): value is VisualizationDesignControl {
  if (!record(value) || !text(value.id, 100) || !text(value.label)
    || value.reference !== undefined && !text(value.reference)) return false;
  if (value.type === "range") {
    return [value.value, value.initialValue, value.min, value.max, value.step].every((item) => typeof item === "number" && Number.isFinite(item))
      && (value.min as number) < (value.max as number) && (value.step as number) > 0
      && (value.value as number) >= (value.min as number) && (value.value as number) <= (value.max as number)
      && (value.initialValue as number) >= (value.min as number) && (value.initialValue as number) <= (value.max as number)
      && (value.unit === undefined || text(value.unit, 30));
  }
  if (value.type === "toggle") return typeof value.value === "boolean" && typeof value.initialValue === "boolean";
  if (value.type === "color") {
    const color = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
    return typeof value.value === "string" && color.test(value.value) && typeof value.initialValue === "string" && color.test(value.initialValue);
  }
  if (value.type !== "select" || !Array.isArray(value.options) || !value.options.length || value.options.length > 12) return false;
  if (!value.options.every((option) => record(option) && text(option.label) && text(option.value))) return false;
  return new Set(value.options.map((option) => option.value)).size === value.options.length
    && value.options.some((option) => option.value === value.value)
    && value.options.some((option) => option.value === value.initialValue);
}

/** The iframe is untrusted. Reject malformed or oversized control catalogs. */
export function parseVisualizationControls(value: unknown): VisualizationControls | null {
  if (!record(value) || (value.language !== "en" && value.language !== "tr") || typeof value.previewing !== "boolean"
    || !Array.isArray(value.carousels) || value.carousels.length > 16
    || !Array.isArray(value.groups) || value.groups.length > 64) return null;
  for (const carousel of value.carousels) {
    if (!record(carousel) || !text(carousel.id, 100) || !text(carousel.label)
      || !text(carousel.previousLabel) || !text(carousel.nextLabel)
      || !Array.isArray(carousel.variants) || !carousel.variants.length || carousel.variants.length > 32
      || !carousel.variants.every((variant) => record(variant) && text(variant.id, 100) && text(variant.label))
      || !uniqueIds(carousel.variants) || !carousel.variants.some((variant) => variant.id === carousel.selectedId)) return null;
  }
  for (const group of value.groups) {
    if (!record(group) || !text(group.id, 100) || !text(group.label) || typeof group.visible !== "boolean"
      || group.variant !== undefined && !text(group.variant)
      || !Array.isArray(group.controls) || group.controls.length > 12
      || !group.controls.every(control) || !uniqueIds(group.controls)) return null;
  }
  if (!uniqueIds(value.groups) || !uniqueIds(value.carousels)) return null;
  return {
    language: value.language,
    previewing: value.previewing,
    carousels: value.carousels.map((item) => ({
      id: item.id, label: item.label, previousLabel: item.previousLabel, nextLabel: item.nextLabel,
      selectedId: item.selectedId, variants: item.variants.map((variant: { id: string; label: string }) => ({ id: variant.id, label: variant.label })),
    })),
    groups: value.groups.map((group) => ({
      id: group.id, label: group.label, visible: group.visible,
      ...(group.variant ? { variant: group.variant } : {}),
      controls: group.controls.map((item: VisualizationDesignControl) => {
        const base = { id: item.id, label: item.label, ...(item.reference ? { reference: item.reference } : {}) };
        if (item.type === "range") return { ...base, type: item.type, value: item.value, initialValue: item.initialValue,
          min: item.min, max: item.max, step: item.step, ...(item.unit ? { unit: item.unit } : {}) };
        if (item.type === "select") return { ...base, type: item.type, value: item.value, initialValue: item.initialValue,
          options: item.options.map((option) => ({ label: option.label, value: option.value })) };
        return { ...base, type: item.type, value: item.value, initialValue: item.initialValue };
      }),
    })),
  } as VisualizationControls;
}
