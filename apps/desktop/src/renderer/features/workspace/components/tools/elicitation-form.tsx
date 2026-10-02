import { useId } from "react";
import { Body, Caption, Checkbox, Input, NativeSelect, Text } from "@/components/ui";
import {
  parseElicitationSchema,
  validateElicitationFields,
  type ElicitationContent,
  type ElicitationField,
} from "@mains/backend/shared/mcp-elicitation";

export type { ElicitationField } from "@mains/backend/shared/mcp-elicitation";
export type ElicitationValues = Record<string, string | boolean | string[]>;
export type BuildContentResult =
  | { ok: true; content: ElicitationContent }
  | { ok: false; missing: string[]; errors: Record<string, string> };

export function parseElicitationFields(schema?: Record<string, unknown>): ElicitationField[] {
  return parseElicitationSchema(schema).fields;
}

export function getElicitationDefaultValues(fields: ElicitationField[]): ElicitationValues {
  return Object.fromEntries(fields.flatMap((field) => field.defaultValue === undefined ? [] : [[
    field.name,
    typeof field.defaultValue === "number" ? String(field.defaultValue)
      : Array.isArray(field.defaultValue) ? [...field.defaultValue] : field.defaultValue,
  ]]));
}

/** Convert input state to protocol types, then apply the same checks as the backend. */
export function buildElicitationContent(fields: ElicitationField[], values: ElicitationValues): BuildContentResult {
  const entries: Array<[string, unknown]> = [];
  for (const field of fields) {
    const raw = values[field.name];
    if (field.type === "boolean") { entries.push([field.name, raw ?? false]); continue; }
    if (field.type === "multiEnum") { entries.push([field.name, raw ?? []]); continue; }
    const value = typeof raw === "string" && field.type !== "enum" ? raw.trim() : raw;
    if (value === undefined || value === "") continue;
    entries.push([field.name, field.type === "number" && typeof value === "string" ? Number(value) : value]);
  }
  const validation = validateElicitationFields(fields, Object.fromEntries(entries));
  if (validation.ok) return validation;
  return {
    ...validation,
    missing: fields.filter((field) => Object.prototype.hasOwnProperty.call(validation.errors, field.name)).map((field) => field.label),
  };
}

const inputClass =
  "w-full rounded-lg bg-primary-100/50 px-3 py-2 text-xs text-primary-900 transition-colors placeholder:text-primary-500 focus:outline-none dark:bg-primary-800/50 dark:text-primary-100 dark:placeholder:text-primary-500";

export function ElicitationForm({ fields, values, onChange, errors = {} }: {
  fields: ElicitationField[];
  values: ElicitationValues;
  onChange: (name: string, value: string | boolean | string[]) => void;
  errors?: Record<string, string>;
}) {
  const formId = useId();
  if (fields.length === 0) return null;
  return (
    <div className="space-y-3 px-3.5 pb-3 sm:px-4">
      {fields.map((field, index) => {
        const id = `${formId}-${index}`;
        const error = Object.prototype.hasOwnProperty.call(errors, field.name) ? errors[field.name] : undefined;
        const optionValues = field.enumValues ?? [];
        return (
          <div key={field.name} className="min-w-0">
            <label htmlFor={field.type === "multiEnum" ? undefined : id} className="mb-1 flex items-baseline gap-1.5">
              <Body size="xs" weight="medium">{field.label}</Body>
              {field.required && <Text as="span" size="xxs" tone="danger" aria-hidden>*</Text>}
            </label>
            {field.description && <Caption tone="faint" className="mb-1 block">{field.description}</Caption>}
            {field.type === "boolean" ? (
              <Checkbox id={id} checked={values[field.name] === true} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
                onChange={(checked) => onChange(field.name, checked)} />
            ) : field.type === "multiEnum" ? (
              <div role="group" aria-label={field.label} aria-describedby={error ? `${id}-error` : undefined} className="flex flex-wrap gap-x-4 gap-y-2">
                {optionValues.map((option, i) => {
                  const selected = Array.isArray(values[field.name]) ? values[field.name] as string[] : [];
                  return <label key={option} className="flex cursor-pointer items-center gap-2 text-xs text-primary-800 dark:text-primary-200">
                    <Checkbox checked={selected.includes(option)} onChange={(checked) => onChange(field.name,
                      checked ? [...selected, option] : selected.filter((value) => value !== option))} />
                    {field.enumLabels?.[i] ?? option}
                  </label>;
                })}
              </div>
            ) : field.type === "enum" ? (
              <NativeSelect id={id} variant="bare" value={typeof values[field.name] === "string" ? values[field.name] as string : ""}
                onChange={(event) => onChange(field.name, event.target.value)} className={inputClass}
                aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}>
                <option value="">Select…</option>
                {optionValues.map((option, i) => <option key={option} value={option}>{field.enumLabels?.[i] ?? option}</option>)}
              </NativeSelect>
            ) : (
              <Input id={id} variant="bare" type={field.isSecret ? "password" : field.type === "number" ? "number" : "text"}
                autoComplete={field.isSecret ? "new-password" : undefined}
                min={field.minimum} max={field.maximum} step={field.type === "number" ? field.integer ? 1 : "any" : undefined}
                minLength={field.minLength} maxLength={field.maxLength}
                value={typeof values[field.name] === "string" ? values[field.name] as string : ""}
                onChange={(event) => onChange(field.name, event.target.value)} className={inputClass}
                aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
            )}
            <Caption
              id={`${id}-error`}
              role={error ? "alert" : undefined}
              aria-hidden={!error}
              tone="danger"
              className="mt-1 block h-[2lh] overflow-y-auto wrap-break-word"
            >
              {error ?? ""}
            </Caption>
          </div>
        );
      })}
    </div>
  );
}
