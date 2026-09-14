import { describe, expect, it } from "vitest";
import {
  buildElicitationContent,
  parseElicitationFields,
  type ElicitationField,
} from "./elicitation-form";

const SCHEMA = {
  type: "object",
  properties: {
    username: { type: "string", title: "Username" },
    apiKey: { type: "string", description: "Personal access token" },
    port: { type: "integer", title: "Port" },
    verbose: { type: "boolean", title: "Verbose" },
    region: { type: "string", enum: ["eu", "us"], title: "Region" },
  },
  required: ["username", "apiKey"],
};

describe("parseElicitationFields", () => {
  it("returns nothing without a usable schema", () => {
    expect(parseElicitationFields(undefined)).toEqual([]);
    expect(parseElicitationFields({ type: "object" })).toEqual([]);
  });

  it("maps each primitive property to a field", () => {
    const byName = Object.fromEntries(
      parseElicitationFields(SCHEMA).map((f) => [f.name, f]),
    );

    expect(byName.username).toMatchObject({ type: "string", label: "Username", required: true });
    expect(byName.port).toMatchObject({ type: "number", label: "Port", required: false });
    expect(byName.verbose).toMatchObject({ type: "boolean", required: false });
    expect(byName.region).toMatchObject({ type: "enum", enumValues: ["eu", "us"] });
  });

  it("falls back to the property name when the schema has no title", () => {
    expect(parseElicitationFields(SCHEMA).find((f) => f.name === "apiKey")?.label).toBe(
      "apiKey",
    );
  });

  // Credentials are a common elicitation payload; they must not render in clear text.
  it("masks credential-looking fields", () => {
    const fields = parseElicitationFields(SCHEMA);
    expect(fields.find((f) => f.name === "apiKey")?.isSecret).toBe(true);
    expect(fields.find((f) => f.name === "username")?.isSecret).toBe(false);
    expect(
      parseElicitationFields({
        properties: { pw: { type: "string", format: "password" } },
      })[0].isSecret,
    ).toBe(true);
  });

  // An MCP elicitation result only carries string | number | boolean | string[],
  // so a nested object has no representation and must not be rendered.
  it("drops properties that cannot round-trip through an elicitation result", () => {
    const fields = parseElicitationFields({
      properties: {
        ok: { type: "string" },
        nested: { type: "object", properties: { a: { type: "string" } } },
        untyped: { description: "no type" },
      },
    });
    expect(fields.map((f) => f.name)).toEqual(["ok"]);
  });
});

describe("buildElicitationContent", () => {
  const fields = parseElicitationFields(SCHEMA);

  it("coerces values to their schema types", () => {
    const result = buildElicitationContent(fields, {
      username: "okan",
      apiKey: "secret",
      port: "8080",
      verbose: true,
      region: "eu",
    });
    expect(result).toEqual({
      ok: true,
      content: { username: "okan", apiKey: "secret", port: 8080, verbose: true, region: "eu" },
    });
  });

  it("reports missing required fields by label instead of submitting a partial payload", () => {
    const result = buildElicitationContent(fields, { username: "  ", apiKey: "" });
    expect(result).toEqual({ ok: false, missing: ["Username", "apiKey"] });
  });

  it("omits blank optional fields rather than sending empty strings", () => {
    const result = buildElicitationContent(fields, { username: "okan", apiKey: "k" });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected ok");
    expect(result.content).not.toHaveProperty("port");
    expect(result.content).not.toHaveProperty("region");
  });

  // An unchecked box is a meaningful `false`, not an unanswered field.
  it("always sends a boolean, checked or not", () => {
    const result = buildElicitationContent(fields, { username: "o", apiKey: "k" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.content.verbose).toBe(false);
  });

  it("treats an unparseable number as missing when required", () => {
    const numeric: ElicitationField[] = [
      { name: "port", label: "Port", type: "number", required: true, isSecret: false },
    ];
    expect(buildElicitationContent(numeric, { port: "abc" })).toEqual({
      ok: false,
      missing: ["Port"],
    });
  });
});
