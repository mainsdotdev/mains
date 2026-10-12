import { describe, expect, it } from "vitest";
import { mcpOutputSegments, mcpStructuredContentOmitted } from "./mcp-output";

describe("MCP public result presentation", () => {
  it("retains an omission flag in serialized envelopes without mistaking ordinary JSON text for one", () => {
    expect(
      mcpStructuredContentOmitted(
        JSON.stringify({ content: [], structuredContentOmitted: true }),
      ),
    ).toBe(true);
    expect(
      mcpStructuredContentOmitted('{"structuredContentOmitted":true}'),
    ).toBe(false);
    expect(
      mcpStructuredContentOmitted({
        content: [],
        structuredContentOmitted: "true",
      }),
    ).toBe(false);
    expect(
      mcpStructuredContentOmitted({
        content: [],
        structuredContent: { structuredContentOmitted: true },
      }),
    ).toBe(false);
  });

  it("keeps text and references while withholding omitted data and UI-only metadata", () => {
    expect(
      mcpOutputSegments({
        content: [
          { type: "text", text: "Preview", _meta: { secret: "block-secret" } },
        ],
        structuredContentOmitted: true,
        structuredContent: { untrustedPartial: "discard" },
        _meta: { secret: "result-secret" },
        resourceLinks: [
          {
            uri: "result://full-data",
            name: "Full result",
            _meta: { secret: "link-secret" },
          },
        ],
      }),
    ).toEqual(["Preview", "Full result: result://full-data"]);
  });

  it("keeps normal public structured data when optional metadata is absent", () => {
    const output = {
      content: [{ type: "text", text: "Action completed." }],
      structuredContent: { count: 3 },
    };
    expect(mcpStructuredContentOmitted(output)).toBe(false);
    expect(mcpOutputSegments(output)).toEqual([
      "Action completed.",
      '{\n  "count": 3\n}',
    ]);
  });
});
