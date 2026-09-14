import type { SchemaProperty } from "./schema-editor-tab";

export function schemaToProperties(schema: Record<string, unknown>): SchemaProperty[] {
  const props = (schema.properties ?? {}) as Record<string, any>;
  const required = (schema.required ?? []) as string[];
  return Object.entries(props).map(([name, def]) => {
    let type: SchemaProperty["type"] = "string";
    let isArray = false;
    if (def?.type === "array") {
      isArray = true;
      type = (def.items?.type as SchemaProperty["type"]) ?? "string";
    } else if (def?.type) {
      type = def.type as SchemaProperty["type"];
    }
    return {
      id: crypto.randomUUID(),
      name,
      type,
      isArray,
      isRequired: required.includes(name),
    };
  });
}

export function propertiesToSchema(
  properties: SchemaProperty[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of properties) {
    if (!p.name.trim()) continue;
    if (p.isArray) {
      props[p.name] = { type: "array", items: { type: p.type } };
    } else {
      props[p.name] = { type: p.type };
    }
    if (p.isRequired) required.push(p.name);
  }
  const schema: Record<string, unknown> = { type: "object", properties: props };
  if (required.length > 0) schema.required = required;
  return schema;
}
