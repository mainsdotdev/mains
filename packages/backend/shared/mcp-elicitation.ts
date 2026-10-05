/** The flat MCP form subset, shared by the renderer and provider response seam. */
export type ElicitationValue = string | number | boolean | string[];
export type ElicitationContent = Record<string, ElicitationValue>;

export interface ElicitationField {
  name: string;
  label: string;
  description?: string;
  type: "string" | "number" | "boolean" | "enum" | "multiEnum";
  enumValues?: string[];
  enumLabels?: string[];
  required: boolean;
  isSecret: boolean;
  defaultValue?: ElicitationValue;
  integer?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
}

function elicitationRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function choices(node: Record<string, unknown>, titledKey: "oneOf" | "anyOf") {
  if (Array.isArray(node.enum) && node.enum.length && node.enum.every((value) => typeof value === "string")) {
    const values = node.enum as string[];
    return { values, labels: values.map((value, i) => Array.isArray(node.enumNames) && typeof node.enumNames[i] === "string" ? node.enumNames[i] : value) };
  }
  const options = node[titledKey];
  if (!Array.isArray(options) || !options.length) return undefined;
  const entries = options.map(elicitationRecord);
  if (entries.some((entry) => typeof entry?.const !== "string")) return undefined;
  return {
    values: entries.map((entry) => entry!.const as string),
    labels: entries.map((entry) => typeof entry!.title === "string" ? entry!.title : entry!.const as string),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Unsupported fields remain visible as an error, never silently accepted as an empty form. */
export function parseElicitationSchema(schema?: Record<string, unknown>): { fields: ElicitationField[]; unsupported: string[] } {
  if (schema === undefined) return { fields: [], unsupported: [] };
  const root = elicitationRecord(schema);
  if (!root || (root.type !== undefined && root.type !== "object")) return { fields: [], unsupported: ["Form schema"] };
  const properties = elicitationRecord(root.properties);
  const required = new Set(Array.isArray(root.required) ? root.required.filter((name): name is string => typeof name === "string") : []);
  const fields: ElicitationField[] = [];
  const unsupported: string[] = root.properties !== undefined && !properties ? ["Form fields"] : [];
  for (const [name, raw] of Object.entries(properties ?? {})) {
    const node = elicitationRecord(raw);
    if (!node) { unsupported.push(name); continue; }
    const label = typeof node.title === "string" && node.title.trim() ? node.title : name;
    const options = node.type === "array" ? choices(elicitationRecord(node.items) ?? {}, "anyOf") : choices(node, "oneOf");
    const type = node.type === "array" && options ? "multiEnum"
      : node.type === "string" && options ? "enum"
      : node.type === "number" || node.type === "integer" ? "number"
      : node.type === "boolean" ? "boolean"
      : node.type === "string" ? "string" : undefined;
    if (!type || ((node.enum !== undefined || node.oneOf !== undefined) && !options)) { unsupported.push(label); continue; }
    fields.push({
      name, label, type, required: required.has(name),
      description: typeof node.description === "string" ? node.description : undefined,
      isSecret: type === "string" && (node.format === "password" || node.writeOnly === true || /password|secret|token|api[-_]?key|credential/i.test(name)),
      ...(options ? { enumValues: options.values, enumLabels: options.labels } : {}),
      integer: node.type === "integer",
      minimum: finiteNumber(node.minimum), maximum: finiteNumber(node.maximum),
      minLength: finiteNumber(node.minLength), maxLength: finiteNumber(node.maxLength),
      minItems: finiteNumber(node.minItems), maxItems: finiteNumber(node.maxItems),
      pattern: typeof node.pattern === "string" ? node.pattern : undefined,
      format: typeof node.format === "string" ? node.format : undefined,
      defaultValue: typeof node.default === "string" || typeof node.default === "boolean" || typeof node.default === "number"
        ? node.default : Array.isArray(node.default) && node.default.every((value) => typeof value === "string") ? [...node.default] : undefined,
    });
  }
  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(properties ?? {}, name) && !unsupported.includes(name)) unsupported.push(name);
  }
  return { fields, unsupported };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function fieldError(field: ElicitationField, value: unknown): string | undefined {
  if (value === undefined) {
    return field.required ? "This field is required." : undefined;
  }
  if (field.required && (field.type === "string" || field.type === "enum") && typeof value === "string" && !value.trim()) return "This field is required.";
  if (field.type === "boolean") return typeof value === "boolean" ? undefined : "Choose yes or no.";
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a valid number.";
    if (field.integer && !Number.isInteger(value)) return "Enter a whole number.";
    if (field.minimum !== undefined && value < field.minimum) return `Minimum: ${field.minimum}.`;
    if (field.maximum !== undefined && value > field.maximum) return `Maximum: ${field.maximum}.`;
    return undefined;
  }
  if (field.type === "multiEnum") {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !field.enumValues?.includes(entry))) return "Choose from the listed options.";
    if (new Set(value).size !== value.length) return "Choose each option only once.";
    if (field.minItems !== undefined && value.length < field.minItems) return `Choose at least ${field.minItems} options.`;
    if (field.maxItems !== undefined && value.length > field.maxItems) return `Choose at most ${field.maxItems} options.`;
    return undefined;
  }
  if (typeof value !== "string") return "Enter text.";
  if (field.type === "enum" && !field.enumValues?.includes(value)) return "Choose from the listed options.";
  const length = Array.from(value).length;
  if (field.minLength !== undefined && length < field.minLength) return `Use at least ${field.minLength} characters.`;
  if (field.maxLength !== undefined && length > field.maxLength) return `Use at most ${field.maxLength} characters.`;
  if (field.pattern) {
    try { if (!new RegExp(field.pattern).test(value)) return "Use the requested format."; }
    catch { return "This field uses an unsupported pattern."; }
  }
  if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address.";
  if (field.format === "uri") {
    try { new URL(value); } catch { return "Enter a valid URL."; }
  }
  if (field.format === "date" && !validDate(value)) return "Enter a valid date (YYYY-MM-DD).";
  if (field.format === "date-time" && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)))) return "Enter a date and time with a timezone.";
  return undefined;
}

export type ElicitationValidation = { ok: true; content: ElicitationContent } | { ok: false; errors: Record<string, string> };

export function validateElicitationFields(fields: readonly ElicitationField[], value: unknown): ElicitationValidation {
  const record = elicitationRecord(value);
  if (!record) return { ok: false, errors: { form: "Invalid form response." } };
  const errors: Array<[string, string]> = [];
  const names = new Set(fields.map((field) => field.name));
  if (Object.keys(record).some((name) => !names.has(name))) errors.push(["form", "The response contains unrequested fields."]);
  for (const field of fields) {
    const error = fieldError(field, Object.prototype.hasOwnProperty.call(record, field.name) ? record[field.name] : undefined);
    if (error) errors.push([field.name, error]);
  }
  return errors.length ? { ok: false, errors: Object.fromEntries(errors) }
    : { ok: true, content: Object.fromEntries(Object.entries(record).filter(([, entry]) => entry !== undefined)) as ElicitationContent };
}

export function validateElicitationContent(schema: Record<string, unknown> | undefined, content: unknown): ElicitationValidation {
  const { fields, unsupported } = parseElicitationSchema(schema);
  return unsupported.length ? { ok: false, errors: { form: `Unsupported fields: ${unsupported.join(", ")}.` } }
    : validateElicitationFields(fields, content);
}
