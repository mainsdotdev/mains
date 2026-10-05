import { describe, expect, it } from "vitest";
import { parseElicitationSchema, validateElicitationContent } from "./mcp-elicitation";

const schema = {
  type: "object",
  properties: {
    calendar: { type: "string", oneOf: [{ const: "work", title: "Work" }, { const: "home", title: "Home" }], default: "work" },
    seats: { type: "integer", minimum: 1, maximum: 5, default: 2 },
    notify: { type: "boolean", default: true },
    people: { type: "array", items: { anyOf: [{ const: "okan", title: "Okan" }, { const: "alex", title: "Alex" }] }, minItems: 1, maxItems: 2, default: ["okan"] },
  },
  required: ["calendar", "seats", "people"],
};

describe("MCP elicitation schema and responses", () => {
  it("preserves titled option values, defaults and primitive constraints", () => {
    const parsed = parseElicitationSchema(schema);
    expect(parsed.unsupported).toEqual([]);
    expect(parsed.fields[0]).toMatchObject({ type: "enum", enumValues: ["work", "home"], enumLabels: ["Work", "Home"], defaultValue: "work" });
    expect(parsed.fields[1]).toMatchObject({ integer: true, minimum: 1, maximum: 5, defaultValue: 2 });
    expect(parsed.fields[3]).toMatchObject({ type: "multiEnum", enumValues: ["okan", "alex"], enumLabels: ["Okan", "Alex"], defaultValue: ["okan"] });
    const content = { calendar: "work", seats: 2, notify: false, people: ["okan"] };
    expect(validateElicitationContent(schema, content)).toEqual({ ok: true, content });
  });

  it.each([
    { calendar: "other" }, { seats: 1.5 }, { seats: 0 }, { seats: 6 }, { seats: "" },
    { seats: NaN }, { seats: Infinity }, { notify: "false" }, { people: ["unknown"] },
    { people: ["okan", "okan"] }, { people: [] }, { people: "okan" },
    { extra: {} }, { seats: undefined },
  ])("rejects invalid typed content (%j)", (override) => {
    expect(validateElicitationContent(schema, { calendar: "work", seats: 2, notify: false, people: ["okan"], ...override })).toMatchObject({ ok: false });
  });

  it("supports untitled choices and legacy enumNames without changing stored values", () => {
    const parsed = parseElicitationSchema({ properties: {
      region: { type: "string", enum: ["eu", "us"], enumNames: ["Europe", "America"] },
      tags: { type: "array", items: { type: "string", enum: ["one", "two"] } },
    } });
    expect(parsed.unsupported).toEqual([]);
    expect(parsed.fields[0]).toMatchObject({ enumLabels: ["Europe", "America"] });
    expect(parsed.fields[1]).toMatchObject({ type: "multiEnum", enumLabels: ["one", "two"] });
  });

  it("checks optional values when supplied and permits omitting them", () => {
    const requested = { properties: { title: { type: "string", minLength: 2 }, seats: { type: "number" } } };
    expect(validateElicitationContent(requested, {})).toEqual({ ok: true, content: {} });
    expect(validateElicitationContent(requested, { title: "" })).toMatchObject({ ok: false });
    expect(validateElicitationContent(requested, { seats: "" })).toMatchObject({ ok: false });
  });

  it("flags unsupported and missing required properties rather than hiding them", () => {
    const unsupported = { type: "object", properties: { nested: { type: "object" } }, required: ["missing"] };
    expect(parseElicitationSchema(unsupported).unsupported).toEqual(["nested", "missing"]);
    expect(validateElicitationContent(unsupported, {})).toMatchObject({ ok: false });
    expect(parseElicitationSchema({ properties: { enum: { type: "string", enum: [1, 2] } } }).unsupported).toEqual(["enum"]);
    expect(parseElicitationSchema([] as never).unsupported).not.toEqual([]);
  });

  it.each([
    [{ type: "string", minLength: 2, maxLength: 3 }, "a", "abc"],
    [{ type: "string", maxLength: 3 }, "abcd", "abc"],
    [{ type: "string", pattern: "^[a-z]+$" }, "123", "abc"],
    [{ type: "string", format: "email" }, "invalid", "okan@example.com"],
    [{ type: "string", format: "uri" }, "no URL", "https://mains.dev"],
    [{ type: "string", format: "date" }, "2026-02-30", "2026-10-02"],
    [{ type: "string", format: "date-time" }, "2026-10-02T10:00:00", "2026-10-02T10:00:00+03:00"],
  ])("checks string constraints and formats (%j)", (property, invalid, valid) => {
    const requested = { properties: { value: property } };
    expect(validateElicitationContent(requested, { value: invalid })).toMatchObject({ ok: false });
    expect(validateElicitationContent(requested, { value: valid })).toMatchObject({ ok: true });
  });

  it("handles keys named like object prototype members as ordinary fields", () => {
    const requested = JSON.parse('{"properties":{"__proto__":{"type":"string"},"toString":{"type":"boolean"}},"required":["__proto__"]}');
    const content = JSON.parse('{"__proto__":"value","toString":false}');
    const result = validateElicitationContent(requested, content);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(Object.prototype.hasOwnProperty.call(result.content, "__proto__")).toBe(true);
    expect(validateElicitationContent(requested, {})).toMatchObject({ ok: false });
  });
});
