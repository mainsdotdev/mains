// XLSX renderer — wraps ExcelJS. Lazy-imported, then renders each worksheet's
// table on demand so a large workbook doesn't materialise every sheet up front.
// Returns a controller the host uses to drive the sheet-tab bar.

import type {
  Border,
  Cell,
  CellErrorValue,
  CellFormulaValue,
  CellHyperlinkValue,
  CellRichTextValue,
  CellSharedFormulaValue,
  CellValue,
  Color,
  Fill,
  Font,
  RichText,
  Workbook,
  Worksheet,
} from "exceljs";

export interface XlsxController {
  sheetNames: string[];
  showSheet: (name: string) => void;
}

export async function renderXlsx(
  buf: ArrayBuffer,
  container: HTMLElement,
): Promise<XlsxController> {
  const mod = await import("exceljs");
  const ExcelJS = ((mod as any).default ?? mod) as typeof import("exceljs");
  const workbook = await loadWorkbook(ExcelJS, buf);

  // Charts and conditional-formatting text rules are either absent or lossy in
  // ExcelJS's model, so recover them straight from the package XML. Never let a
  // parse hiccup here take down the table render.
  const extras = await extractSheetExtras(buf).catch(() => new Map<string, SheetExtras>());

  const sheets = new Map(workbook.worksheets.map((sheet) => [sheet.name, sheet]));
  const sheetNames = Array.from(sheets.keys());

  const sheetEls = new Map<string, HTMLDivElement>();
  for (const name of sheetNames) {
    const el = document.createElement("div");
    el.className = "xlsx-sheet";
    el.style.display = "none";
    el.dataset.sheet = name;
    container.appendChild(el);
    sheetEls.set(name, el);
  }

  const showSheet = (name: string) => {
    for (const [n, el] of sheetEls) {
      el.style.display = n === name ? "block" : "none";
    }
    const el = sheetEls.get(name);
    if (el && el.dataset.rendered !== "1") {
      const worksheet = sheets.get(name);
      if (worksheet) el.appendChild(renderWorksheet(worksheet, extras.get(name)));
      el.dataset.rendered = "1";
    }
  };

  if (sheetNames[0]) showSheet(sheetNames[0]);

  return { sheetNames, showSheet };
}

// SpreadsheetML main namespace. Some generators (e.g. Go's unioffice) serialise
// it under an explicit prefix — <x:workbook>, <x:sheetData>, … — which is valid
// OOXML but defeats ExcelJS: its parser matches unprefixed tag names only, so it
// reads zero worksheets and throws "Cannot read properties of undefined (reading
// 'sheets')". When a load lands empty, strip the prefix and retry once.
const SPREADSHEETML_MAIN_NS =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

async function loadWorkbook(
  ExcelJS: typeof import("exceljs"),
  buf: ArrayBuffer,
): Promise<Workbook> {
  const workbook = new ExcelJS.Workbook();
  let loadError: unknown;
  try {
    await workbook.xlsx.load(buf as any);
    if (workbook.worksheets.length > 0) return workbook;
  } catch (err) {
    loadError = err;
  }

  const normalized = await normalizeSpreadsheetNamespace(buf);
  if (normalized) {
    const retry = new ExcelJS.Workbook();
    await retry.xlsx.load(normalized as any);
    return retry;
  }

  // Nothing to normalise — a genuinely empty workbook, or an unreadable file.
  if (loadError) throw loadError;
  return workbook;
}

// Rewrites the prefixed SpreadsheetML namespace to the default namespace across
// every XML part, leaving other prefixes (notably relationship `r:id`) intact.
// Returns null when no part used a prefix, so the caller keeps the original.
export async function normalizeSpreadsheetNamespace(
  buf: ArrayBuffer,
): Promise<Uint8Array | null> {
  const jszipMod: any = await import("jszip");
  const JSZip = jszipMod.default ?? jszipMod;

  let zip: any;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return null;
  }

  let changed = false;
  await Promise.all(
    Object.values<any>(zip.files).map(async (entry) => {
      if (entry.dir || !entry.name.endsWith(".xml")) return;
      const fixed = stripMainNamespacePrefix(await entry.async("string"));
      if (fixed !== null) {
        zip.file(entry.name, fixed);
        changed = true;
      }
    }),
  );

  return changed ? zip.generateAsync({ type: "uint8array" }) : null;
}

// Demotes whichever prefix is bound to the SpreadsheetML main namespace to the
// default namespace, e.g. `<x:row …>` → `<row …>` and `xmlns:x="…main"` →
// `xmlns="…main"`. Element tags only — attribute prefixes (`r:id`) are untouched
// because they live in a different namespace ExcelJS still expects prefixed.
export function stripMainNamespacePrefix(xml: string): string | null {
  const decl = new RegExp(
    `xmlns:([A-Za-z_][\\w.-]*)\\s*=\\s*"${escapeRegExp(SPREADSHEETML_MAIN_NS)}"`,
  ).exec(xml);
  if (!decl) return null;

  const prefix = escapeRegExp(decl[1]);
  return xml
    .replace(new RegExp(`</${prefix}:`, "g"), "</")
    .replace(new RegExp(`<${prefix}:`, "g"), "<")
    .replace(
      new RegExp(
        `xmlns:${prefix}(\\s*=\\s*"${escapeRegExp(SPREADSHEETML_MAIN_NS)}")`,
        "g",
      ),
      "xmlns$1",
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderWorksheet(
  worksheet: Worksheet,
  extras?: SheetExtras,
): HTMLElement {
  const table = document.createElement("table");
  table.className = "xlsx-sheet-table";

  const mergeInfo = collectMergeInfo(worksheet);
  const rowCount = Math.max(worksheet.rowCount, mergeInfo.maxRow, 1);
  const columnCount = Math.max(worksheet.columnCount, mergeInfo.maxColumn, 1);
  const cfEffects = collectConditionalEffects(worksheet, extras?.textRules);

  // Cumulative pixel offsets per column/row edge, used to anchor floating
  // charts. Index i holds the left/top of the (1-based) column/row i.
  const defaultRowPx = pointsToPixels(worksheet.properties?.defaultRowHeight || 15);
  const colLefts: number[] = [0];
  const rowTops: number[] = [0];

  const colgroup = document.createElement("colgroup");
  for (let colNumber = 1; colNumber <= columnCount; colNumber += 1) {
    const col = document.createElement("col");
    const column = worksheet.getColumn(colNumber);
    const width = column.hidden ? 0 : columnWidthToPixels(column.width);
    if (column.hidden) {
      col.style.display = "none";
    } else {
      col.style.width = `${width}px`;
    }
    colgroup.appendChild(col);
    colLefts.push(colLefts[colNumber - 1] + width);
  }
  table.appendChild(colgroup);

  const tbody = document.createElement("tbody");
  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const tr = document.createElement("tr");
    const height = row.hidden ? 0 : pointsToPixels(row.height || 0) || defaultRowPx;
    if (row.hidden) tr.style.display = "none";
    else if (row.height) tr.style.height = `${height}px`;
    rowTops.push(rowTops[rowNumber - 1] + height);

    for (let colNumber = 1; colNumber <= columnCount; colNumber += 1) {
      const mergeKey = cellKey(rowNumber, colNumber);
      if (mergeInfo.coveredCells.has(mergeKey)) continue;

      const td = document.createElement("td");
      const span = mergeInfo.topLeftSpans.get(mergeKey);
      if (span) {
        if (span.rowspan > 1) td.rowSpan = span.rowspan;
        if (span.colspan > 1) td.colSpan = span.colspan;
      }

      const cell = row.getCell(colNumber);
      appendCellContent(cell, td);
      applyCellStyle(cell, td, cfEffects.get(mergeKey));
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const charts = extras?.charts ?? [];
  if (charts.length === 0) return table;

  // Float each chart over the grid at its anchor cell, mirroring where the
  // spreadsheet app drew it.
  const wrapper = document.createElement("div");
  wrapper.className = "xlsx-sheet-wrapper";
  wrapper.style.position = "relative";
  wrapper.style.width = "max-content";
  wrapper.appendChild(table);

  for (const chart of charts) {
    const box = document.createElement("div");
    box.className = "xlsx-chart";
    box.style.position = "absolute";
    box.style.left = `${colLefts[Math.min(chart.fromCol, columnCount)] ?? 0}px`;
    box.style.top = `${rowTops[Math.min(chart.fromRow, rowCount)] ?? 0}px`;
    box.style.width = `${chart.widthPx}px`;
    box.style.height = `${chart.heightPx}px`;
    box.innerHTML = buildChartSvg(chart.spec, chart.widthPx, chart.heightPx);
    wrapper.appendChild(box);
  }

  return wrapper;
}

function collectMergeInfo(worksheet: Worksheet) {
  const topLeftSpans = new Map<string, { rowspan: number; colspan: number }>();
  const coveredCells = new Set<string>();
  let maxRow = 0;
  let maxColumn = 0;

  for (const ref of worksheet.model.merges ?? []) {
    const range = decodeRange(ref);
    if (!range) continue;

    maxRow = Math.max(maxRow, range.bottom);
    maxColumn = Math.max(maxColumn, range.right);
    topLeftSpans.set(cellKey(range.top, range.left), {
      rowspan: range.bottom - range.top + 1,
      colspan: range.right - range.left + 1,
    });

    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let col = range.left; col <= range.right; col += 1) {
        if (row !== range.top || col !== range.left) {
          coveredCells.add(cellKey(row, col));
        }
      }
    }
  }

  return { topLeftSpans, coveredCells, maxRow, maxColumn };
}

function appendCellContent(cell: Cell, target: HTMLTableCellElement) {
  const value = cell.value;
  const hyperlink = getHyperlink(cell);

  if (isRichTextValue(value)) {
    const parent = hyperlink ? createSafeAnchor(hyperlink) : target;
    appendRichText(value.richText, parent);
    if (parent !== target) target.appendChild(parent);
    return;
  }

  const text = getCellText(cell);
  if (!text) return;

  if (hyperlink) {
    const anchor = createSafeAnchor(hyperlink);
    anchor.textContent = text;
    target.appendChild(anchor);
    return;
  }

  target.textContent = text;
}

function appendRichText(parts: RichText[], target: HTMLElement) {
  for (const part of parts) {
    const span = document.createElement("span");
    span.textContent = part.text;
    if (part.font) applyFontStyle(part.font, span);
    target.appendChild(span);
  }
}

function getCellText(cell: Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString();
  if (isErrorValue(value)) return value.error;
  if (isHyperlinkValue(value)) return value.text;
  if (isRichTextValue(value)) return value.richText.map((part) => part.text).join("");
  if (isFormulaValue(value)) return cellResultToText(value.result);
  if (cell.text) return cell.text;
  return String(value);
}

function cellResultToText(value: CellFormulaValue["result"]): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString();
  if (isErrorValue(value)) return value.error;
  return String(value);
}

function getHyperlink(cell: Cell): string | null {
  const value = cell.value;
  const hyperlink = isHyperlinkValue(value) ? value.hyperlink : cell.hyperlink;
  if (!hyperlink) return null;
  return isSafeHref(hyperlink) ? hyperlink : null;
}

function createSafeAnchor(href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  return anchor;
}

function applyCellStyle(
  cell: Cell,
  td: HTMLTableCellElement,
  effect?: CellCfEffect,
) {
  applyFontStyle(cell.font, td);
  applyFill(cell.fill, td);

  const alignment = cell.alignment;
  if (alignment?.horizontal) td.style.textAlign = horizontalAlignmentToCss(alignment.horizontal);
  if (alignment?.vertical) td.style.verticalAlign = verticalAlignmentToCss(alignment.vertical);
  if (alignment?.wrapText) td.style.whiteSpace = "normal";

  const border = cell.border;
  if (border?.top) td.style.borderTop = borderToCss(border.top);
  if (border?.right) td.style.borderRight = borderToCss(border.right);
  if (border?.bottom) td.style.borderBottom = borderToCss(border.bottom);
  if (border?.left) td.style.borderLeft = borderToCss(border.left);

  // Conditional formatting wins over the base style: a matched text rule recolors
  // the cell, a data bar paints a proportional gradient behind the value.
  if (effect?.bg) td.style.backgroundColor = effect.bg;
  if (effect?.fontColor) td.style.color = effect.fontColor;
  if (effect?.bold) td.style.fontWeight = "700";
  if (effect?.dataBar) {
    td.style.backgroundImage = dataBarToCss(effect.dataBar);
    td.style.backgroundRepeat = "no-repeat";
  }
}

function applyFill(fill: Fill | undefined, td: HTMLTableCellElement) {
  if (!fill) return;
  if (fill.type === "pattern") {
    const color = fillToCss(fill);
    if (color) td.style.backgroundColor = color;
  } else if (fill.type === "gradient") {
    const image = gradientFillToCss(fill);
    if (image) td.style.backgroundImage = image;
  }
}

function applyFontStyle(font: Partial<Font> | undefined, element: HTMLElement) {
  if (!font) return;

  if (font.name) element.style.fontFamily = font.name;
  if (font.size) element.style.fontSize = `${font.size}pt`;
  if (font.bold) element.style.fontWeight = "700";
  if (font.italic) element.style.fontStyle = "italic";
  if (font.underline && font.underline !== "none") element.style.textDecoration = "underline";

  const color = colorToCss(font.color);
  if (color) element.style.color = color;
}

function fillToCss(fill: Fill | undefined): string | null {
  if (!fill || fill.type !== "pattern" || fill.pattern === "none") return null;
  return colorToCss(fill.fgColor) ?? colorToCss(fill.bgColor);
}

function borderToCss(border: Partial<Border>): string {
  const width = borderWidthToCss(border.style);
  const style = borderStyleToCss(border.style);
  const color = colorToCss(border.color) ?? "#d4d4d4";
  return `${width} ${style} ${color}`;
}

function borderWidthToCss(style: Border["style"] | undefined): string {
  if (style === "medium" || style === "mediumDashed" || style === "mediumDashDot" || style === "mediumDashDotDot") {
    return "2px";
  }
  if (style === "thick") return "3px";
  return "1px";
}

function borderStyleToCss(style: Border["style"] | undefined): string {
  if (style === "dotted" || style === "hair") return "dotted";
  if (style === "dashed" || style === "mediumDashed") return "dashed";
  if (style === "double") return "double";
  return "solid";
}

function colorToCss(color: Partial<Color> | undefined): string | null {
  if (!color?.argb) return null;
  const argb = color.argb.replace(/^#/, "");
  if (argb.length === 8 && argb.slice(0, 2).toLowerCase() !== "00") {
    return `#${argb.slice(2)}`;
  }
  if (argb.length === 6) return `#${argb}`;
  return null;
}

// A "#RRGGBB" color as an rgba() string, so data-bar gradients can fade the same
// hue. Returns null when the input isn't a 6-digit hex color.
function hexToRgba(css: string, alpha: number): string | null {
  const hex = css.replace(/^#/, "");
  if (hex.length !== 6) return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function gradientFillToCss(fill: Fill | undefined): string | null {
  if (!fill || fill.type !== "gradient") return null;
  const stops = (fill.stops ?? [])
    .map((stop) => {
      const color = colorToCss(stop.color);
      return color ? `${color} ${Math.round((stop.position ?? 0) * 100)}%` : null;
    })
    .filter((s): s is string => s !== null);
  if (stops.length < 2) return null;

  // ExcelJS exposes `gradient: 'angle'` (linear) or `'path'` (radial). Excel's
  // angle runs clockwise from 3 o'clock; CSS runs clockwise from 12 o'clock.
  if (fill.gradient === "path") {
    return `radial-gradient(circle, ${stops.join(", ")})`;
  }
  const angle = Math.round((fill.degree ?? 0) + 90);
  return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}

function dataBarToCss(bar: { color: string; pct: number; gradient: boolean }): string {
  const pct = Math.max(0, Math.min(100, bar.pct));
  const start = bar.gradient ? (hexToRgba(bar.color, 0.45) ?? bar.color) : bar.color;
  // A solid (or left-to-right fading) bar up to pct, transparent beyond it.
  return (
    `linear-gradient(to right, ${start} 0%, ${bar.color} ${pct}%, ` +
    `transparent ${pct}%, transparent 100%)`
  );
}

function horizontalAlignmentToCss(value: NonNullable<Cell["alignment"]>["horizontal"]): string {
  if (value === "center" || value === "centerContinuous") return "center";
  if (value === "right") return "right";
  if (value === "justify" || value === "distributed") return "justify";
  return "left";
}

function verticalAlignmentToCss(value: NonNullable<Cell["alignment"]>["vertical"]): string {
  if (value === "middle") return "middle";
  if (value === "bottom") return "bottom";
  return "top";
}

function columnWidthToPixels(width: number | undefined): number {
  return Math.max(40, Math.min(640, Math.round((width ?? 10) * 7 + 5)));
}

function pointsToPixels(points: number): number {
  return Math.max(1, Math.round(points * (96 / 72)));
}

function decodeRange(ref: string) {
  const [startRef, endRef = startRef] = ref.replace(/\$/g, "").split(":");
  const start = decodeCellRef(startRef);
  const end = decodeCellRef(endRef);
  if (!start || !end) return null;

  return {
    top: Math.min(start.row, end.row),
    left: Math.min(start.column, end.column),
    bottom: Math.max(start.row, end.row),
    right: Math.max(start.column, end.column),
  };
}

function decodeCellRef(ref: string): { row: number; column: number } | null {
  const match = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!match) return null;
  return {
    row: Number(match[2]),
    column: decodeColumnLetters(match[1]),
  };
}

function decodeColumnLetters(letters: string): number {
  let column = 0;
  for (const letter of letters.toUpperCase()) {
    column = column * 26 + letter.charCodeAt(0) - 64;
  }
  return column;
}

function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Date);
}

function isErrorValue(value: unknown): value is CellErrorValue {
  return isObject(value) && typeof value.error === "string";
}

function isRichTextValue(value: CellValue): value is CellRichTextValue {
  return isObject(value) && Array.isArray((value as CellRichTextValue).richText);
}

function isHyperlinkValue(value: CellValue): value is CellHyperlinkValue {
  return isObject(value) && typeof (value as CellHyperlinkValue).hyperlink === "string";
}

function isFormulaValue(value: CellValue): value is CellFormulaValue | CellSharedFormulaValue {
  return isObject(value) && ("formula" in value || "sharedFormula" in value);
}

// ---------------------------------------------------------------------------
// Conditional formatting — data bars and text-matched recolouring.
// ---------------------------------------------------------------------------

interface CellCfEffect {
  bg?: string;
  fontColor?: string;
  bold?: boolean;
  dataBar?: { color: string; pct: number; gradient: boolean };
}

interface CfTextRule {
  text: string;
  operator: string;
}

const TEXT_RULE_TYPES = new Set([
  "containsText",
  "notContainsText",
  "beginsWith",
  "endsWith",
]);

// Resolves every conditional-formatting rule on the sheet to a per-cell effect.
// ExcelJS hands us the rule styles and data-bar colors but drops the match text
// for `containsText` rules, so the caller threads those back in (keyed by the
// rule priority, which both ExcelJS and the raw XML preserve).
export function collectConditionalEffects(
  worksheet: Worksheet,
  textRules?: Map<number, CfTextRule>,
): Map<string, CellCfEffect> {
  const effects = new Map<string, CellCfEffect>();
  const claimed = new Set<string>(); // cells already coloured by a text rule
  const cfs: any[] = (worksheet as any).conditionalFormattings ?? [];

  for (const cf of cfs) {
    const ranges = expandSqref(cf.ref);
    if (ranges.length === 0) continue;
    // Lower priority number wins, so evaluate in that order and let the first
    // text match claim the cell.
    const rules = [...(cf.rules ?? [])].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
    );

    for (const rule of rules) {
      if (rule.type === "dataBar") {
        applyDataBarRule(worksheet, ranges, rule, effects);
      } else if (TEXT_RULE_TYPES.has(rule.type)) {
        const meta = textRules?.get(rule.priority);
        applyTextRule(worksheet, ranges, rule, meta, claimed, effects);
      }
    }
  }

  return effects;
}

function applyDataBarRule(
  worksheet: Worksheet,
  ranges: ReturnType<typeof decodeRange>[],
  rule: any,
  effects: Map<string, CellCfEffect>,
) {
  const color = colorToCss(rule.color) ?? "#638ec6";
  const gradient = rule.gradient !== false;
  const cells: { key: string; value: number }[] = [];

  forEachCell(ranges, (row, col, key) => {
    const value = cellNumber(worksheet.getRow(row).getCell(col));
    if (value !== null) cells.push({ key, value });
  });
  if (cells.length === 0) return;

  const values = cells.map((c) => c.value);
  const cfvo = rule.cfvo ?? [];
  const min = cfvoValue(cfvo[0], values, "min");
  const max = cfvoValue(cfvo[1], values, "max");
  const minLength = typeof rule.minLength === "number" ? rule.minLength : 0;
  const maxLength = typeof rule.maxLength === "number" ? rule.maxLength : 100;

  for (const { key, value } of cells) {
    const pct = dataBarPercent(value, min, max, minLength, maxLength);
    const effect = effects.get(key) ?? {};
    effect.dataBar = { color, pct, gradient };
    effects.set(key, effect);
  }
}

function applyTextRule(
  worksheet: Worksheet,
  ranges: ReturnType<typeof decodeRange>[],
  rule: any,
  meta: CfTextRule | undefined,
  claimed: Set<string>,
  effects: Map<string, CellCfEffect>,
) {
  const text = meta?.text ?? rule.text;
  if (!text) return;
  const operator = meta?.operator ?? rule.operator ?? "containsText";
  const style = rule.style ?? {};
  const bg = colorToCss(style.fill?.bgColor) ?? colorToCss(style.fill?.fgColor) ?? undefined;
  const fontColor = colorToCss(style.font?.color) ?? undefined;
  const bold = style.font?.bold === true;
  if (!bg && !fontColor && !bold) return;

  forEachCell(ranges, (row, col, key) => {
    if (claimed.has(key)) return;
    const cellText = getCellText(worksheet.getRow(row).getCell(col));
    if (!matchesTextRule(cellText, operator, text)) return;
    claimed.add(key);
    const effect = effects.get(key) ?? {};
    if (bg) effect.bg = bg;
    if (fontColor) effect.fontColor = fontColor;
    if (bold) effect.bold = true;
    effects.set(key, effect);
  });
}

export function matchesTextRule(
  cellText: string,
  operator: string,
  text: string,
): boolean {
  if (!text) return false;
  const haystack = cellText.toLowerCase();
  const needle = text.toLowerCase();
  switch (operator) {
    case "notContainsText":
      return !haystack.includes(needle);
    case "beginsWith":
      return haystack.startsWith(needle);
    case "endsWith":
      return haystack.endsWith(needle);
    case "containsText":
    default:
      return haystack.includes(needle);
  }
}

export function dataBarPercent(
  value: number,
  min: number,
  max: number,
  minLength = 0,
  maxLength = 100,
): number {
  if (max <= min) return value > min ? maxLength : minLength;
  const ratio = (value - min) / (max - min);
  const pct = minLength + ratio * (maxLength - minLength);
  return Math.max(0, Math.min(100, pct));
}

function cfvoValue(cfvo: any, values: number[], which: "min" | "max"): number {
  if (cfvo?.type === "num" && Number.isFinite(Number(cfvo.value))) {
    return Number(cfvo.value);
  }
  return which === "min" ? Math.min(...values) : Math.max(...values);
}

function cellNumber(cell: Cell): number | null {
  const value = cell.value as any;
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && typeof value.result === "number") {
    return value.result;
  }
  const parsed = Number(getCellText(cell));
  return Number.isFinite(parsed) ? parsed : null;
}

function expandSqref(ref: string | undefined): ReturnType<typeof decodeRange>[] {
  if (!ref) return [];
  return ref
    .split(/\s+/)
    .map((part) => decodeRange(part))
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

function forEachCell(
  ranges: ReturnType<typeof decodeRange>[],
  fn: (row: number, col: number, key: string) => void,
) {
  for (const range of ranges) {
    if (!range) continue;
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let col = range.left; col <= range.right; col += 1) {
        fn(row, col, cellKey(row, col));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Package XML extraction — chart definitions and the conditional-format text
// that ExcelJS's model omits. Walked straight from the .xlsx zip.
// ---------------------------------------------------------------------------

const OOXML_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

interface ChartSeries {
  name: string;
  color: string | null;
  values: (number | null)[];
}

export interface ChartSpec {
  title: string | null;
  kind: "column" | "bar" | "line" | "area" | "pie" | "scatter";
  categories: string[];
  series: ChartSeries[];
}

interface ChartPlacement {
  fromCol: number;
  fromRow: number;
  widthPx: number;
  heightPx: number;
  spec: ChartSpec;
}

interface SheetExtras {
  textRules: Map<number, CfTextRule>;
  charts: ChartPlacement[];
}

async function extractSheetExtras(buf: ArrayBuffer): Promise<Map<string, SheetExtras>> {
  const result = new Map<string, SheetExtras>();
  const jszipMod: any = await import("jszip");
  const JSZip = jszipMod.default ?? jszipMod;
  const zip = await JSZip.loadAsync(buf);

  const read = async (path: string): Promise<string | null> => {
    const file = zip.file(path.replace(/^\//, ""));
    return file ? file.async("string") : null;
  };

  const workbookXml = await read("xl/workbook.xml");
  if (!workbookXml) return result;
  const wbDoc = parseXml(workbookXml);
  const wbRels = parseRels(await read("xl/_rels/workbook.xml.rels"));

  for (const sheetEl of qAll(wbDoc, "sheet")) {
    const name = sheetEl.getAttribute("name");
    const rid = relId(sheetEl);
    const target = rid ? wbRels.get(rid) : undefined;
    if (!name || !target) continue;

    const sheetPath = resolvePath("xl/workbook.xml", target);
    const sheetXml = await read(sheetPath);
    if (!sheetXml) continue;
    const sheetDoc = parseXml(sheetXml);

    const textRules = new Map<number, CfTextRule>();
    for (const ruleEl of qAll(sheetDoc, "cfRule")) {
      const text = ruleEl.getAttribute("text");
      const priority = Number(ruleEl.getAttribute("priority"));
      if (text && Number.isFinite(priority)) {
        textRules.set(priority, {
          text,
          operator: ruleEl.getAttribute("operator") ?? "containsText",
        });
      }
    }

    const charts = await extractCharts(sheetDoc, sheetPath, read);
    result.set(name, { textRules, charts });
  }

  return result;
}

async function extractCharts(
  sheetDoc: Document,
  sheetPath: string,
  read: (path: string) => Promise<string | null>,
): Promise<ChartPlacement[]> {
  const out: ChartPlacement[] = [];
  const drawingEl = q(sheetDoc, "drawing");
  const drawingRid = drawingEl ? relId(drawingEl) : null;
  if (!drawingRid) return out;

  const sheetRels = parseRels(await read(relsPathFor(sheetPath)));
  const drawingTarget = sheetRels.get(drawingRid);
  if (!drawingTarget) return out;

  const drawingPath = resolvePath(sheetPath, drawingTarget);
  const drawingXml = await read(drawingPath);
  if (!drawingXml) return out;
  const drawingDoc = parseXml(drawingXml);
  const drawingRels = parseRels(await read(relsPathFor(drawingPath)));

  const anchors = [
    ...qAll(drawingDoc, "oneCellAnchor"),
    ...qAll(drawingDoc, "twoCellAnchor"),
  ];
  for (const anchor of anchors) {
    const chartEl = q(anchor, "chart");
    const chartRid = chartEl ? relId(chartEl) : null;
    const chartTarget = chartRid ? drawingRels.get(chartRid) : undefined;
    if (!chartTarget) continue;

    const chartXml = await read(resolvePath(drawingPath, chartTarget));
    if (!chartXml) continue;
    const spec = parseChart(parseXml(chartXml));
    if (!spec) continue;

    out.push({ ...anchorPosition(anchor), spec });
  }

  return out;
}

function anchorPosition(anchor: Element): Omit<ChartPlacement, "spec"> {
  const from = directChild(anchor, "from");
  const fromCol = Number(text(directChild(from, "col")) ?? "0") || 0;
  const fromRow = Number(text(directChild(from, "row")) ?? "0") || 0;

  const ext = directChild(anchor, "ext");
  const widthPx = ext ? emuToPx(Number(ext.getAttribute("cx"))) : 0;
  const heightPx = ext ? emuToPx(Number(ext.getAttribute("cy"))) : 0;

  return {
    fromCol,
    fromRow,
    widthPx: widthPx || 480,
    heightPx: heightPx || 288,
  };
}

function parseChart(doc: Document): ChartSpec | null {
  const kind = chartKind(doc);
  if (!kind) return null;

  const title = text(q(q(doc, "title"), "t"));
  let categories: string[] = [];
  const series: ChartSeries[] = [];

  for (const ser of qAll(doc, "ser")) {
    const cats = readPoints(q(ser, "cat")).map((p) => p.text);
    if (cats.length > categories.length) categories = cats;
    series.push({
      name: text(q(q(ser, "tx"), "v")) ?? "",
      color: serColor(ser),
      values: readPoints(q(ser, "val")).map((p) =>
        Number.isFinite(Number(p.text)) ? Number(p.text) : null,
      ),
    });
  }
  if (series.length === 0) return null;

  return { title, kind, categories, series };
}

function chartKind(doc: Document): ChartSpec["kind"] | null {
  if (q(doc, "barChart")) {
    return attrVal(q(doc, "barDir")) === "bar" ? "bar" : "column";
  }
  if (q(doc, "lineChart")) return "line";
  if (q(doc, "areaChart")) return "area";
  if (q(doc, "pieChart") || q(doc, "doughnutChart")) return "pie";
  if (q(doc, "scatterChart")) return "scatter";
  return null;
}

function serColor(ser: Element): string | null {
  const clr = q(q(ser, "spPr"), "srgbClr");
  const val = clr?.getAttribute("val");
  return val ? `#${val}` : null;
}

// Reads `<c:pt idx><c:v>` points into a dense, index-ordered array.
function readPoints(el: Element | null): { text: string }[] {
  if (!el) return [];
  const out: { text: string }[] = [];
  for (const pt of qAll(el, "pt")) {
    const idx = Number(pt.getAttribute("idx") ?? "0");
    out[idx] = { text: text(q(pt, "v")) ?? "" };
  }
  return Array.from(out, (p) => p ?? { text: "" });
}

// --- tiny namespace-agnostic XML helpers (match on localName) ---

function parseXml(xml: string): Document {
  // Package parts (notably .rels) often start with a UTF-8 BOM; strip it so
  // stricter XML parsers don't choke on content before the declaration.
  return new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ""), "application/xml");
}

function qAll(root: Element | Document | null, localName: string): Element[] {
  if (!root) return [];
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

function q(root: Element | Document | null, localName: string): Element | null {
  return qAll(root, localName)[0] ?? null;
}

function directChild(parent: Element | null, localName: string): Element | null {
  if (!parent) return null;
  for (const child of Array.from(parent.children)) {
    if (child.localName === localName) return child;
  }
  return null;
}

function text(el: Element | null): string | null {
  const value = el?.textContent?.trim();
  return value ? value : null;
}

function attrVal(el: Element | null): string | null {
  return el?.getAttribute("val") ?? null;
}

function relId(el: Element): string | null {
  return el.getAttributeNS(OOXML_REL_NS, "id") ?? el.getAttribute("r:id");
}

function parseRels(xml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const rel of qAll(parseXml(xml), "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  const dir = partPath.slice(0, slash);
  const file = partPath.slice(slash + 1);
  return `${dir}/_rels/${file}.rels`;
}

// Resolves a relationship Target (absolute "/xl/…" or relative "../x") against
// the part that declared it, into a zip entry path.
function resolvePath(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = basePart.slice(0, basePart.lastIndexOf("/")).split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") segments.pop();
    else if (seg !== ".") segments.push(seg);
  }
  return segments.join("/");
}

function emuToPx(emu: number): number {
  return Number.isFinite(emu) ? Math.round(emu / 9525) : 0;
}

// ---------------------------------------------------------------------------
// Chart rendering — a compact SVG drawn from the parsed ChartSpec.
// ---------------------------------------------------------------------------

const CHART_PALETTE = [
  "#4e79a7",
  "#59a14f",
  "#e15759",
  "#f28e2b",
  "#76b7b2",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
];

export function buildChartSvg(spec: ChartSpec, width: number, height: number): string {
  const body =
    spec.kind === "pie"
      ? pieChartBody(spec, width, height)
      : cartesianChartBody(spec, width, height);

  const title = spec.title
    ? `<text x="${round(width / 2)}" y="16" text-anchor="middle" ` +
      `font-size="13" font-weight="600" fill="#1f2937">${escapeXml(spec.title)}</text>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" style="background:#fff;border:1px solid #d9d9d9;` +
    `font-family:inherit">${title}${body}</svg>`
  );
}

function cartesianChartBody(spec: ChartSpec, width: number, height: number): string {
  const pad = { top: spec.title ? 28 : 14, right: 16, bottom: 36, left: 44 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = Math.max(10, height - pad.top - pad.bottom);
  const x0 = pad.left;
  const y0 = pad.top;

  const categories = spec.categories.length
    ? spec.categories
    : spec.series[0]?.values.map((_, i) => String(i + 1)) ?? [];
  const allValues = spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const maxValue = Math.max(1, ...allValues);

  const yFor = (v: number) => y0 + plotH - (v / maxValue) * plotH;
  const parts: string[] = [];

  // Horizontal gridlines + value-axis labels.
  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const v = (maxValue * i) / ticks;
    const y = round(yFor(v));
    parts.push(
      `<line x1="${x0}" y1="${y}" x2="${round(x0 + plotW)}" y2="${y}" ` +
        `stroke="#e5e7eb" stroke-dasharray="3 3"/>`,
    );
    parts.push(
      `<text x="${x0 - 6}" y="${y + 3}" text-anchor="end" font-size="10" ` +
        `fill="#6b7280">${formatTick(v)}</text>`,
    );
  }

  const groups = Math.max(1, categories.length);
  const groupW = plotW / groups;

  if (spec.kind === "line" || spec.kind === "area" || spec.kind === "scatter") {
    spec.series.forEach((s, si) => {
      const color = s.color ?? CHART_PALETTE[si % CHART_PALETTE.length];
      const points = s.values.map((v, i) => {
        const x = round(x0 + groupW * (i + 0.5));
        return { x, y: round(yFor(v ?? 0)), defined: v !== null };
      });
      const line = points
        .filter((p) => p.defined)
        .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
        .join(" ");
      if (spec.kind === "area") {
        parts.push(
          `<path d="${line} L ${points[points.length - 1]?.x ?? x0} ${round(y0 + plotH)} ` +
            `L ${points[0]?.x ?? x0} ${round(y0 + plotH)} Z" fill="${color}" fill-opacity="0.25"/>`,
        );
      }
      parts.push(`<path d="${line}" fill="none" stroke="${color}" stroke-width="2"/>`);
      points.forEach((p) => {
        if (p.defined) parts.push(`<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${color}"/>`);
      });
    });
  } else {
    // Column / bar — clustered per category.
    const seriesCount = Math.max(1, spec.series.length);
    const bandW = groupW * 0.7;
    const barW = bandW / seriesCount;
    const showLabels = categories.length <= 12 && spec.series.length === 1;

    spec.series.forEach((s, si) => {
      const color = s.color ?? CHART_PALETTE[si % CHART_PALETTE.length];
      s.values.forEach((v, i) => {
        if (v === null) return;
        const value = Math.max(0, v);
        const x = round(x0 + groupW * i + (groupW - bandW) / 2 + barW * si);
        const y = round(yFor(value));
        const h = round(y0 + plotH - y);
        if (h <= 0) return;
        parts.push(
          `<rect x="${x}" y="${y}" width="${round(barW)}" height="${h}" fill="${color}" rx="1"/>`,
        );
        if (showLabels) {
          parts.push(
            `<text x="${round(x + barW / 2)}" y="${y - 3}" text-anchor="middle" ` +
              `font-size="10" fill="#374151">${formatTick(value)}</text>`,
          );
        }
      });
    });
  }

  // Category-axis labels.
  categories.forEach((cat, i) => {
    parts.push(
      `<text x="${round(x0 + groupW * (i + 0.5))}" y="${round(y0 + plotH + 14)}" ` +
        `text-anchor="middle" font-size="10" fill="#6b7280">${escapeXml(truncate(cat, 10))}</text>`,
    );
  });

  // Axis baselines.
  parts.push(
    `<line x1="${x0}" y1="${round(y0 + plotH)}" x2="${round(x0 + plotW)}" y2="${round(y0 + plotH)}" stroke="#9ca3af"/>`,
  );
  parts.push(`<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${round(y0 + plotH)}" stroke="#9ca3af"/>`);

  // Legend (only when more than one series).
  if (spec.series.length > 1) {
    spec.series.forEach((s, si) => {
      const color = s.color ?? CHART_PALETTE[si % CHART_PALETTE.length];
      const lx = x0 + si * 90;
      parts.push(`<rect x="${round(lx)}" y="2" width="9" height="9" fill="${color}"/>`);
      parts.push(
        `<text x="${round(lx + 13)}" y="10" font-size="10" fill="#374151">${escapeXml(truncate(s.name, 12))}</text>`,
      );
    });
  }

  return parts.join("");
}

function pieChartBody(spec: ChartSpec, width: number, height: number): string {
  const series = spec.series[0];
  if (!series) return "";
  const values = series.values.map((v) => Math.max(0, v ?? 0));
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return "";

  const cx = width * 0.36;
  const cy = height / 2 + (spec.title ? 6 : 0);
  const r = Math.min(width * 0.32, height * 0.38);
  const parts: string[] = [];

  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    const slice = (v / total) * Math.PI * 2;
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    parts.push(`<path d="${arcPath(cx, cy, r, angle, angle + slice)}" fill="${color}"/>`);
    angle += slice;
  });

  // Legend down the right side.
  spec.categories.forEach((cat, i) => {
    if (i >= values.length) return;
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    const ly = height / 2 - (spec.categories.length * 14) / 2 + i * 14;
    const lx = width * 0.72;
    parts.push(`<rect x="${round(lx)}" y="${round(ly)}" width="9" height="9" fill="${color}"/>`);
    parts.push(
      `<text x="${round(lx + 13)}" y="${round(ly + 8)}" font-size="10" fill="#374151">${escapeXml(truncate(cat, 14))}</text>`,
    );
  });

  return parts.join("");
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const sx = cx + r * Math.cos(start);
  const sy = cy + r * Math.sin(start);
  const ex = cx + r * Math.cos(end);
  const ey = cy + r * Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${round(cx)} ${round(cy)} L ${round(sx)} ${round(sy)} A ${round(r)} ${round(r)} 0 ${largeArc} 1 ${round(ex)} ${round(ey)} Z`;
}

function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(value < 10 ? 1 : 0);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
