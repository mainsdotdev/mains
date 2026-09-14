import {
  Body,
  Caption,
  Checkbox,
  Input,
  NativeSelect,
  Text,
} from "@/components/ui";

/**
 * A single input derived from an MCP elicitation's `requestedSchema`.
 *
 * The schema is JSON Schema, but only the object-with-primitive-properties
 * subset is expressible as an MCP elicitation result (`content` values are
 * string | number | boolean | string[]), so that is the subset rendered here.
 */
export interface ElicitationField {
  name: string;
  label: string;
  description?: string;
  type: "string" | "number" | "boolean" | "enum";
  enumValues?: string[];
  required: boolean;
  /** Rendered as a masked input — credentials are a common elicitation payload. */
  isSecret: boolean;
}

type SchemaNode = Record<string, unknown>;

function asRecord(value: unknown): SchemaNode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as SchemaNode;
}

function looksSecret(name: string, node: SchemaNode): boolean {
  if (node.format === "password") return true;
  if (node.writeOnly === true) return true;
  return /password|secret|token|api[-_]?key|credential/i.test(name);
}

/**
 * Flatten an elicitation `requestedSchema` into renderable fields.
 *
 * Properties whose type cannot round-trip through an MCP elicitation result
 * (nested objects, arrays of non-strings) are dropped rather than rendered as
 * something the server would reject.
 */
export function parseElicitationFields(
  schema?: Record<string, unknown>,
): ElicitationField[] {
  const root = asRecord(schema);
  const properties = asRecord(root?.properties);
  if (!properties) return [];

  const required = new Set(
    Array.isArray(root?.required)
      ? (root!.required as unknown[]).filter(
          (r): r is string => typeof r === "string",
        )
      : [],
  );

  const fields: ElicitationField[] = [];
  for (const [name, rawNode] of Object.entries(properties)) {
    const node = asRecord(rawNode);
    if (!node) continue;

    const label =
      typeof node.title === "string" && node.title.trim() ? node.title : name;
    const description =
      typeof node.description === "string" ? node.description : undefined;

    const enumValues = Array.isArray(node.enum)
      ? (node.enum as unknown[]).filter((v): v is string => typeof v === "string")
      : undefined;

    let type: ElicitationField["type"];
    if (enumValues && enumValues.length > 0) {
      type = "enum";
    } else if (node.type === "boolean") {
      type = "boolean";
    } else if (node.type === "number" || node.type === "integer") {
      type = "number";
    } else if (node.type === "string") {
      type = "string";
    } else {
      // Unsupported (object, array, union, or absent) — not expressible.
      continue;
    }

    fields.push({
      name,
      label,
      description,
      type,
      enumValues,
      required: required.has(name),
      isSecret: type === "string" && looksSecret(name, node),
    });
  }
  return fields;
}

export type ElicitationValues = Record<string, string | boolean>;

export type BuildContentResult =
  | { ok: true; content: Record<string, string | number | boolean> }
  | { ok: false; missing: string[] };

/**
 * Turn collected form state into an MCP elicitation `content` object.
 *
 * Reports missing required fields instead of submitting a partial payload —
 * the server would reject it and the user would see an opaque failure rather
 * than which field was blank.
 */
export function buildElicitationContent(
  fields: ElicitationField[],
  values: ElicitationValues,
): BuildContentResult {
  const content: Record<string, string | number | boolean> = {};
  const missing: string[] = [];

  for (const field of fields) {
    const raw = values[field.name];

    if (field.type === "boolean") {
      // An unchecked box is a real `false`, never a missing value.
      content[field.name] = raw === true;
      continue;
    }

    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      if (field.required) missing.push(field.label);
      continue;
    }

    if (field.type === "number") {
      const parsed = Number(text);
      if (Number.isNaN(parsed)) {
        if (field.required) missing.push(field.label);
        continue;
      }
      content[field.name] = parsed;
      continue;
    }

    content[field.name] = text;
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, content };
}

const inputClass =
  "w-full rounded-lg bg-primary-100/50 px-3 py-2 text-xs text-primary-900 transition-colors placeholder:text-primary-500 focus:outline-none dark:bg-primary-800/50 dark:text-primary-100 dark:placeholder:text-primary-500";

export function ElicitationForm({
  fields,
  values,
  onChange,
}: {
  fields: ElicitationField[];
  values: ElicitationValues;
  onChange: (name: string, value: string | boolean) => void;
}) {
  if (fields.length === 0) return null;

  return (
    <div className="space-y-3 px-3.5 pb-3 sm:px-4">
      {fields.map((field) => (
        <label key={field.name} className="block min-w-0">
          <div className="mb-1 flex items-baseline gap-1.5">
            <Body size="xs" weight="medium">{field.label}</Body>
            {field.required && (
              <Text as="span" size="xxs" tone="danger" aria-hidden>
                *
              </Text>
            )}
          </div>
          {field.description && (
            <Caption tone="faint" className="mb-1 block">
              {field.description}
            </Caption>
          )}

          {field.type === "boolean" ? (
            <Checkbox
              checked={values[field.name] === true}
              onChange={(checked: boolean) => onChange(field.name, checked)}
            />
          ) : field.type === "enum" ? (
            <NativeSelect
              variant="bare"
              value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
              onChange={(e) => onChange(field.name, e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {field.enumValues?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input
              variant="bare"
              type={field.isSecret ? "password" : field.type === "number" ? "number" : "text"}
              autoComplete={field.isSecret ? "new-password" : undefined}
              value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
              onChange={(e) => onChange(field.name, e.target.value)}
              className={inputClass}
            />
          )}
        </label>
      ))}
    </div>
  );
}
