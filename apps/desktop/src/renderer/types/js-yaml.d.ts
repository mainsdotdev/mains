// js-yaml's browser build does not ship declarations. Keep the surface used
// by the Markdown document viewer explicit; parsed document values are unknown.
declare module "js-yaml" {
  export const JSON_SCHEMA: object;
  export function load(source: string, options?: { schema?: object }): unknown;
  export function dump(value: unknown, options?: { schema?: object; lineWidth?: number }): string;
}
