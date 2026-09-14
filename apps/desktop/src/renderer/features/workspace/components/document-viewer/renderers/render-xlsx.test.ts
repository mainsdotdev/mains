import JSZip from "jszip";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildChartSvg,
  collectConditionalEffects,
  dataBarPercent,
  gradientFillToCss,
  matchesTextRule,
  normalizeSpreadsheetNamespace,
  stripMainNamespacePrefix,
  type ChartSpec,
} from "./render-xlsx";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

// Builds a minimal but valid .xlsx whose SpreadsheetML parts use a prefixed
// namespace (<x:workbook>, <x:row>, …) — the shape produced by generators like
// Go's unioffice that ExcelJS cannot read directly.
function prefixedWorkbookBytes(): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );

  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<x:workbook xmlns:x="${MAIN_NS}" xmlns:r="${REL_NS}">` +
      `<x:sheets><x:sheet name="Sheet1" sheetId="1" r:id="rId1"/></x:sheets>` +
      `</x:workbook>`,
  );

  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`,
  );

  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<x:worksheet xmlns:x="${MAIN_NS}">` +
      `<x:sheetData><x:row r="1">` +
      `<x:c r="A1" t="inlineStr"><x:is><x:t>Hello</x:t></x:is></x:c>` +
      `</x:row></x:sheetData>` +
      `</x:worksheet>`,
  );

  return zip.generateAsync({ type: "uint8array" });
}

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as any);
  return workbook;
}

describe("stripMainNamespacePrefix", () => {
  it("demotes the prefixed main namespace to the default namespace", () => {
    const input =
      `<x:workbook xmlns:x="${MAIN_NS}" xmlns:r="${REL_NS}">` +
      `<x:sheets><x:sheet name="S" sheetId="1" r:id="rId1"/></x:sheets>` +
      `</x:workbook>`;

    const out = stripMainNamespacePrefix(input);

    expect(out).not.toBeNull();
    expect(out).toContain(`<workbook xmlns="${MAIN_NS}"`);
    expect(out).toContain("<sheets>");
    expect(out).toContain("</workbook>");
    // Element prefixes are gone, but the relationships attribute keeps its prefix.
    expect(out).not.toMatch(/<x:/);
    expect(out).not.toMatch(/<\/x:/);
    expect(out).toContain('r:id="rId1"');
  });

  it("returns null when the main namespace is already unprefixed", () => {
    expect(stripMainNamespacePrefix(`<workbook xmlns="${MAIN_NS}"/>`)).toBeNull();
  });

  it("returns null for parts that do not declare the main namespace", () => {
    const rels =
      `<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`;
    expect(stripMainNamespacePrefix(rels)).toBeNull();
  });

  it("handles a custom prefix bound to the main namespace", () => {
    const input = `<ns0:workbook xmlns:ns0="${MAIN_NS}"><ns0:sheets/></ns0:workbook>`;
    const out = stripMainNamespacePrefix(input);
    expect(out).toBe(`<workbook xmlns="${MAIN_NS}"><sheets/></workbook>`);
  });
});

describe("normalizeSpreadsheetNamespace", () => {
  it("makes a prefixed workbook loadable by ExcelJS", async () => {
    const bytes = await prefixedWorkbookBytes();

    // The prefixed file is unreadable as-is — this is the reported failure.
    await expect(load(bytes)).rejects.toThrow(/sheets/);

    const normalized = await normalizeSpreadsheetNamespace(
      bytes.buffer as ArrayBuffer,
    );
    expect(normalized).not.toBeNull();

    const workbook = await load(normalized!);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Sheet1"]);
    expect(workbook.worksheets[0].getCell("A1").text).toBe("Hello");
  });

  it("returns null for a workbook that already uses the default namespace", async () => {
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet("Plain");
    sheet.getCell("A1").value = "Hi";
    const bytes = new Uint8Array(await source.xlsx.writeBuffer());

    expect(
      await normalizeSpreadsheetNamespace(bytes.buffer as ArrayBuffer),
    ).toBeNull();
  });
});

describe("matchesTextRule", () => {
  it("evaluates each operator case-insensitively", () => {
    expect(matchesTextRule("Done early", "containsText", "done")).toBe(true);
    expect(matchesTextRule("Planned", "containsText", "Done")).toBe(false);
    expect(matchesTextRule("Resting", "beginsWith", "rest")).toBe(true);
    expect(matchesTextRule("All done", "endsWith", "done")).toBe(true);
    expect(matchesTextRule("Active", "notContainsText", "done")).toBe(true);
  });
});

describe("dataBarPercent", () => {
  it("scales value between min and max", () => {
    expect(dataBarPercent(45, 0, 45)).toBeCloseTo(100);
    expect(dataBarPercent(0, 0, 45)).toBe(0);
    expect(dataBarPercent(30, 0, 45)).toBeCloseTo(66.667, 2);
  });

  it("clamps and handles a degenerate range", () => {
    expect(dataBarPercent(120, 0, 100)).toBe(100);
    expect(dataBarPercent(5, 5, 5)).toBe(0);
    expect(dataBarPercent(9, 5, 5)).toBe(100);
  });
});

describe("gradientFillToCss", () => {
  it("maps an angle gradient to a CSS linear-gradient (Excel→CSS angle)", () => {
    const css = gradientFillToCss({
      type: "gradient",
      gradient: "angle",
      degree: 90,
      stops: [
        { position: 0, color: { argb: "FFFF0000" } },
        { position: 1, color: { argb: "FF0000FF" } },
      ],
    } as any);
    expect(css).toBe("linear-gradient(180deg, #FF0000 0%, #0000FF 100%)");
  });

  it("maps a path gradient to a radial-gradient", () => {
    const css = gradientFillToCss({
      type: "gradient",
      gradient: "path",
      stops: [
        { position: 0, color: { argb: "FFFFFFFF" } },
        { position: 1, color: { argb: "FF000000" } },
      ],
    } as any);
    expect(css).toContain("radial-gradient(circle,");
  });

  it("returns null for a pattern fill", () => {
    expect(gradientFillToCss({ type: "pattern", pattern: "solid" } as any)).toBeNull();
  });
});

describe("collectConditionalEffects", () => {
  it("derives data bars and text-matched recolouring from a worksheet", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getCell("A1").value = "Done"; // matches the green text rule
    ws.getCell("A2").value = "Rest"; // no rule → untouched
    ws.getCell("B1").value = 10; // max of the data-bar range
    ws.getCell("B2").value = 5; // min of the data-bar range

    ws.addConditionalFormatting({
      ref: "A1:A2",
      rules: [
        {
          type: "containsText",
          operator: "containsText",
          text: "Done",
          priority: 1,
          style: {
            font: { bold: true, color: { argb: "FF166534" } },
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDCFCE7" } },
          },
        } as any,
      ],
    });
    ws.addConditionalFormatting({
      ref: "B1:B2",
      rules: [
        {
          type: "dataBar",
          priority: 2,
          cfvo: [{ type: "min" }, { type: "max" }],
          color: { argb: "FF22C55E" },
          gradient: true,
        } as any,
      ],
    });

    const effects = collectConditionalEffects(ws);

    expect(effects.get("1:1")).toMatchObject({
      bg: "#DCFCE7",
      fontColor: "#166534",
      bold: true,
    });
    expect(effects.get("2:1")?.bg).toBeUndefined();
    expect(effects.get("1:2")?.dataBar).toMatchObject({ color: "#22C55E", pct: 100 });
    expect(effects.get("2:2")?.dataBar?.pct).toBe(0);
  });
});

describe("buildChartSvg", () => {
  const spec: ChartSpec = {
    title: "Workout Minutes by Day",
    kind: "column",
    categories: ["Monday", "Tuesday", "Wednesday"],
    series: [{ name: "Minutes", color: "#22C55E", values: [45, 30, 0] }],
  };

  it("renders a column chart with bars, title, and category labels", () => {
    const svg = buildChartSvg(spec, 460, 240);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Workout Minutes by Day");
    expect(svg).toContain('fill="#22C55E"'); // series colour
    expect(svg).toContain("Monday");
    // Two non-zero values → two bars (the 0-value category draws none).
    expect((svg.match(/<rect /g) ?? []).length).toBe(2);
    // Data labels for the single series.
    expect(svg).toContain(">45<");
  });

  it("renders a pie chart as slices with a legend", () => {
    const svg = buildChartSvg({ ...spec, kind: "pie" }, 300, 200);
    expect(svg).toContain("<path");
    expect(svg).toContain("Tuesday");
  });

  it("escapes category and title text", () => {
    const svg = buildChartSvg(
      { title: "<b>x</b>", kind: "column", categories: ["a&b"], series: [{ name: "s", color: null, values: [1] }] },
      200,
      150,
    );
    expect(svg).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(svg).toContain("a&amp;b");
    expect(svg).not.toContain("<b>x</b>");
  });
});
