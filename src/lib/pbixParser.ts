// PBIX parser  -  runs in the browser via JSZip.
// A .pbix is a ZIP containing "Report/Layout" (UTF-16LE JSON) plus other parts.
// Power BI nests stringified JSON inside JSON ("config", "filters", "query"
// fields are strings of JSON). We walk the tree and parse opportunistically.

import JSZip from "jszip";

export interface ParsedVisual {
  visualId: string;
  id: string;
  name: string;
  displayName: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  w: number;
  h: number;
  z: number;
  altText: string | null;
  titleVisible: boolean;
  titleText: string | null;
  titleFontPt: number | null;
  titleColor: string | null;
  // Extracted style hints
  labelFontPt: number | null;
  labelColor: string | null;
  categoryColor: string | null;
  axisColor: string | null;
  background: string | null;
  // Axis titles  -  null means the visual has no axes (e.g. card, slicer)
  hasAxes: boolean;
  xAxisTitleVisible: boolean | null;
  yAxisTitleVisible: boolean | null;
  fontSizes: number[]; // every pt found
  textColors: string[];
  fillColors: string[]; // series / data colours
  // True when a shape/textbox/image visual carries human-readable text (e.g.
  // a label inside a rectangle). Used to decide whether to require alt text.
  hasText: boolean;
  // Fields bound to this visual, e.g. ["Sales[Amount]", "Date[Year]"]. Extracted
  // from singleVisual.projections / prototypeQuery so we can identify visuals
  // that share a type or have no title.
  fields: string[];
  /**
   * Tab order index for keyboard navigation.
   *  - integer >= 0 → element receives focus at that position
   *  - -1            → explicitly hidden from tab order (decorative)
   *  - null          → not authored (Power BI will assign automatic order)
   */
  tabOrder: number | null;
  /** Normalised authored tab position. Hidden visuals are represented by
   *  isHiddenFromTabOrder=true and tabOrderIndex=null, not as an authored index.
   *
   *  IMPORTANT - this field means two DIFFERENT things depending on whether
   *  normalisePowerBiLayoutTabOrder (below) fired for this page:
   *   - Usually (raw values NOT all non-negative multiples of 1000): this is
   *     the untouched raw authored value, where empirically a HIGHER number
   *     is EARLIER in the tab sequence (confirmed against a real PBIP page
   *     authored 25/20/15/10/5/0, in that tab-sequence order).
   *   - When normalisePowerBiLayoutTabOrder's narrow heuristic fires (all
   *     authored values on the page are unique, non-negative, multiples of
   *     1000, matching the pattern PBIR appears to use for group-internal
   *     tabOrder): this has been REWRITTEN to a 1..N rank where 1 = the
   *     visual with the LARGEST raw value (i.e. rank 1 = first), which is
   *     ASCENDING - the opposite comparison direction from the usual case.
   *  Nothing downstream can tell which of the two it's looking at from the
   *  number alone, so do not compare this field directly to build an
   *  authored order - use tabOrderRank instead, which is always the same
   *  direction regardless of which case applies. This field, and
   *  normalisePowerBiLayoutTabOrder itself, are left exactly as they were:
   *  every existing consumer (including anything that displays a raw tab
   *  order value to the user) keeps behaving exactly as before. */
  tabOrderIndex: number | null;
  /** The visual's position in the true authored tab sequence: 1 = first, 2 =
   *  second, etc. Unlike tabOrderIndex, this is ALWAYS "ascending, 1 =
   *  first" - regardless of whether normalisePowerBiLayoutTabOrder fired for
   *  this page - so any code that needs to know the real authored order
   *  should sort by this field, ascending, and never by tabOrderIndex.
   *  Computed once per page (see assignTabOrderRanks below) from every
   *  non-hidden, tabOrder-authored visual's UNTOUCHED raw tabOrder value, by
   *  sorting descending (largest raw value = rank 1) and numbering 1..N -
   *  deliberately computed from the pristine raw value, before
   *  normalisePowerBiLayoutTabOrder has a chance to rewrite tabOrderIndex,
   *  so it means the same thing whether or not that function ends up
   *  firing. Null for a hidden or unauthored (tabOrderIndex == null) visual. */
  tabOrderRank: number | null;
  /** True only when Power BI explicitly marks the visual as excluded from the
   *  Selection pane tab sequence. This is distinct from an unset tab order. */
  isHiddenFromTabOrder: boolean;
  /** True when the visual has no semantic content (empty shape/image) and
   *  should not normally receive focus. */
  isDecorative: boolean;
  /** For a `type === "visualGroup"` container only: the author-given group
   *  name (Selection pane label), e.g. "Regional KPIs". Null for every other
   *  visual type, and for a group whose name was never set. */
  groupDisplayName: string | null;
  /** The `id` of the visual-group container this visual is nested inside
   *  (Selection pane grouping), or null when the visual sits directly on the
   *  page. Populated from PBIR's `parentGroupName` (see pbirParser.ts); a
   *  visual group container can itself be nested inside another group, so
   *  this forms a chain, not just one level. Currently only populated for
   *  PBIR (PBIP) projects - the legacy .pbix Layout code path does not
   *  resolve group nesting, so this is always null there. */
  parentGroupId: string | null;
  rawObjects?: any;
}

export interface ParsedPage {
  id: string;
  name: string;
  displayName: string;
  width: number;
  height: number;
  hidden: boolean;
  pageTitleVisible: boolean;
  visuals: ParsedVisual[];
}

export interface ParsedReport {
  fileName: string;
  fileSize: number;
  canvasWidth: number;
  canvasHeight: number;
  themeColors: string[];
  pages: ParsedPage[];
}

export class PBIXParseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PBIXParseError";
  }
}

// ---- Helpers ----

function utf16LeDecode(buf: Uint8Array): string {
  // Strip BOM if present
  let start = 0;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) start = 2;
  // Use TextDecoder when possible
  try {
    return new TextDecoder("utf-16le").decode(buf.subarray(start));
  } catch {
    let out = "";
    for (let i = start; i + 1 < buf.length; i += 2) {
      out += String.fromCharCode(buf[i] | (buf[i + 1] << 8));
    }
    return out;
  }
}

function tryParseJSON<T = any>(s: string | undefined | null): T | null {
  if (!s || typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Recursively expand any string fields that look like JSON.
function expand(node: any, depth = 0): any {
  if (depth > 8 || node == null) return node;
  if (typeof node === "string") {
    const trimmed = node.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      const parsed = tryParseJSON(trimmed);
      if (parsed != null) return expand(parsed, depth + 1);
    }
    return node;
  }
  if (Array.isArray(node)) return node.map((n) => expand(n, depth + 1));
  if (typeof node === "object") {
    const out: any = {};
    for (const k of Object.keys(node)) out[k] = expand(node[k], depth + 1);
    return out;
  }
  return node;
}

// Walk an object and collect all values matching a predicate.
function collect(node: any, predicate: (key: string, value: any, path: string[]) => boolean, path: string[] = [], acc: any[] = []): any[] {
  if (node == null) return acc;
  if (Array.isArray(node)) {
    node.forEach((v, i) => collect(v, predicate, [...path, String(i)], acc));
    return acc;
  }
  if (typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (predicate(k, node[k], path)) acc.push(node[k]);
      collect(node[k], predicate, [...path, k], acc);
    }
  }
  return acc;
}

function normalizeColorLiteral(raw: string, allowBare = false): string[] {
  const token = raw.replace(/^['"]+|['"]+$/g, "").trim();
  if (!token) return [];

  if (/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(token)) {
    return [token.toUpperCase()];
  }

  if (/^0x[0-9a-fA-F]{6}$/i.test(token)) {
    return [`#${token.slice(2).toUpperCase()}`];
  }

  if (/^0x[0-9a-fA-F]{8}$/i.test(token)) {
    const hex = token.slice(2);
    return [`#${hex.slice(2).toUpperCase()}`];
  }

  if (allowBare && /^[0-9a-fA-F]{6}$/.test(token)) {
    return [`#${token.toUpperCase()}`];
  }

  if (allowBare && /^[0-9a-fA-F]{8}$/.test(token)) {
    return [`#${token.slice(2).toUpperCase()}`];
  }

  return [];
}

function extractColorLiterals(value: string, allowBare = false): string[] {
  const matches = new Set<string>();
  const patterns = [
    /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/g,
    /\b0x[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of value.match(pattern) ?? []) {
      for (const color of normalizeColorLiteral(match, allowBare)) matches.add(color);
    }
  }

  return Array.from(matches);
}

// Try to find a colour string inside a property-value tree.
function findColor(node: any): string | null {
  if (node == null) return null;
  if (typeof node === "string") {
    const exact = normalizeColorLiteral(node, true);
    if (exact[0]) return exact[0];
    const [match] = extractColorLiterals(node, false);
    if (match) return match;
    return null;
  }
  if (Array.isArray(node)) {
    for (const v of node) {
      const r = findColor(v);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    if (node.solid && node.solid.color) {
      const c = findColor(node.solid.color);
      if (c) return c;
    }
    if (node.expr && node.expr.Literal && typeof node.expr.Literal.Value === "string") {
      const exact = normalizeColorLiteral(node.expr.Literal.Value, true);
      if (exact[0]) return exact[0];
      const [match] = extractColorLiterals(node.expr.Literal.Value, false);
      if (match) return match;
    }
    for (const k of Object.keys(node)) {
      const r = findColor(node[k]);
      if (r) return r;
    }
  }
  return null;
}

function findColors(node: any, acc = new Set<string>()): string[] {
  if (node == null) return Array.from(acc);
  if (typeof node === "string") {
    for (const match of normalizeColorLiteral(node, true)) acc.add(match);
    for (const match of extractColorLiterals(node, false)) acc.add(match);
    return Array.from(acc);
  }
  if (Array.isArray(node)) {
    for (const value of node) findColors(value, acc);
    return Array.from(acc);
  }
  if (typeof node === "object") {
    if (node.solid?.color) findColors(node.solid.color, acc);
    if (typeof node.expr?.Literal?.Value === "string") {
      for (const match of normalizeColorLiteral(node.expr.Literal.Value, true)) acc.add(match);
      for (const match of extractColorLiterals(node.expr.Literal.Value, false)) acc.add(match);
    }
    for (const key of Object.keys(node)) findColors(node[key], acc);
  }
  return Array.from(acc);
}

function findNumber(node: any): number | null {
  if (node == null) return null;
  if (typeof node === "number") return node;
  if (typeof node === "string") {
    const n = parseFloat(node);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof node === "object") {
    if (node.expr?.Literal?.Value != null) {
      const v = String(node.expr.Literal.Value).replace(/[^\d.\-]/g, "");
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }
    for (const k of Object.keys(node)) {
      const r = findNumber(node[k]);
      if (r != null) return r;
    }
  }
  return null;
}

function findBool(node: any): boolean | null {
  if (node == null) return null;
  if (typeof node === "boolean") return node;
  if (typeof node === "string") {
    const v = node.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  }
  if (Array.isArray(node)) {
    for (const v of node) {
      const r = findBool(v);
      if (r != null) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    if (node.expr?.Literal?.Value != null) {
      const v = String(node.expr.Literal.Value).toLowerCase();
      if (v === "true") return true;
      if (v === "false") return false;
    }
    for (const k of Object.keys(node)) {
      const r = findBool(node[k]);
      if (r != null) return r;
    }
  }
  return null;
}

function findText(node: any): string | null {
  if (node == null) return null;
  if (typeof node === "string") {
    // Power BI literal strings are wrapped in quotes (e.g. "'Hello'") sometimes.
    const t = node.replace(/^'+|'+$/g, "").trim();
    return t || null;
  }
  if (typeof node === "object") {
    if (node.expr?.Literal?.Value != null) {
      const v = String(node.expr.Literal.Value).replace(/^'+|'+$/g, "").trim();
      return v || null;
    }
    for (const k of Object.keys(node)) {
      const r = findText(node[k]);
      if (r) return r;
    }
  }
  return null;
}

function extractTabOrderState(...sources: any[]): { tabOrderIndex: number | null; isHiddenFromTabOrder: boolean } {
  for (const source of sources) {
    if (source == null) continue;
    if (typeof source === "number") {
      // Only the documented legacy sentinel (-1) means "explicitly hidden
      // from tab order". Modern PBIR position.tabOrder can legitimately hold
      // large or unusual values (e.g. a shape inserted before any manual
      // reordering can carry a large negative default) that are still real,
      // active positions in the tab sequence  -  they must not be silently
      // treated as hidden, or decorative-but-focusable elements go undetected.
      if (source === -1) return { tabOrderIndex: null, isHiddenFromTabOrder: true };
      return { tabOrderIndex: Math.round(source), isHiddenFromTabOrder: false };
    }
    if (typeof source === "string") {
      const value = source.trim().toLowerCase().replace(/^['"]+|['"]+$/g, "");
      if (["-", "hidden", "hide", "excluded", "exclude", "none"].includes(value)) {
        return { tabOrderIndex: null, isHiddenFromTabOrder: true };
      }
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        if (parsed === -1) return { tabOrderIndex: null, isHiddenFromTabOrder: true };
        return { tabOrderIndex: Math.round(parsed), isHiddenFromTabOrder: false };
      }
      const cleaned = Number(value.replace(/[^\d.\-]/g, ""));
      if (Number.isFinite(cleaned)) {
        if (cleaned === -1) return { tabOrderIndex: null, isHiddenFromTabOrder: true };
        return { tabOrderIndex: Math.round(cleaned), isHiddenFromTabOrder: false };
      }
    }
    if (typeof source === "object") {
      const literal = source.expr?.Literal?.Value ?? source.expr?.literal?.value ?? source.value ?? source.Value;
      const fromLiteral = extractTabOrderState(literal);
      if (fromLiteral.tabOrderIndex != null || fromLiteral.isHiddenFromTabOrder) return fromLiteral;
    }
  }
  for (const source of sources) {
    if (source == null || typeof source !== "object") continue;
    const nestedTabOrderValues = collect(source, (key) => key.toLowerCase() === "taborder" || key.toLowerCase() === "taborderindex");
    for (const value of nestedTabOrderValues) {
      const state = extractTabOrderState(value);
      if (state.tabOrderIndex != null || state.isHiddenFromTabOrder) return state;
    }
    const hiddenFlags = collect(source, (key, value) => {
      const normalisedKey = key.toLowerCase();
      return (normalisedKey.includes("taborder") || normalisedKey.includes("tab")) &&
        (normalisedKey.includes("hidden") || normalisedKey.includes("hide") || normalisedKey.includes("exclude")) &&
        (typeof value === "boolean" || typeof value === "string");
    });
    for (const flag of hiddenFlags) {
      const isHidden = findBool(flag);
      if (isHidden === true) return { tabOrderIndex: null, isHiddenFromTabOrder: true };
    }
  }
  return { tabOrderIndex: null, isHiddenFromTabOrder: false };
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function layoutPositionTabOrderSources(visualContainer: unknown, cfg: unknown): unknown[] {
  const out: unknown[] = [];
  const visualContainerRecord = asRecord(visualContainer);
  const visualContainerConfig = asRecord(visualContainerRecord?.config);
  const cfgRecord = asRecord(cfg);
  const layoutLists = [cfgRecord?.layouts, visualContainerRecord?.layouts, visualContainerConfig?.layouts];
  for (const layouts of layoutLists) {
    if (!Array.isArray(layouts)) continue;
    for (const layout of layouts) {
      const position = asRecord(asRecord(layout)?.position);
      if (position?.tabOrder != null) out.push(position.tabOrder);
    }
  }
  return out;
}

function normalisePowerBiLayoutTabOrder(visuals: ParsedVisual[]): ParsedVisual[] {
  const authored = visuals.filter((v) => !v.isHiddenFromTabOrder && v.tabOrderIndex != null);
  const values = authored.map((v) => v.tabOrderIndex as number);
  const uniqueValues = new Set(values);

  if (
    authored.length < 2 ||
    uniqueValues.size !== authored.length ||
    !values.every((value) => Number.isInteger(value) && value >= 0 && value % 1000 === 0) ||
    Math.max(...values) < 1000
  ) {
    return visuals;
  }

  const rankByRawValue = new Map<number, number>();
  [...uniqueValues]
    .sort((a, b) => b - a)
    .forEach((value, index) => rankByRawValue.set(value, index + 1));

  return visuals.map((visual) => {
    if (visual.isHiddenFromTabOrder || visual.tabOrderIndex == null) return visual;
    const normalisedIndex = rankByRawValue.get(visual.tabOrderIndex);
    if (normalisedIndex == null) return visual;
    return { ...visual, tabOrder: normalisedIndex, tabOrderIndex: normalisedIndex };
  });
}

// ---- Visual extraction ----

function extractVisual(visualContainer: any, idx: number): ParsedVisual {
  const cfg = expand(visualContainer.config);
  const single = cfg?.singleVisual ?? {};
  const objects = single.objects ?? {};
  const vcObjects = single.vcObjects ?? {};

  const fontSizes: number[] = [];
  const textColors = new Set<string>();
  const fillColors = new Set<string>();

  const collectColors = (source: any, keys: string[], target: Set<string>) => {
    for (const key of keys) {
      collect(source, (k) => k === key).forEach((value) => {
        findColors(value).forEach((color) => target.add(color));
      });
    }
  };

  // Sweep all objects for fontSize / colour / fill
  collect(objects, (k) => k === "fontSize").forEach((v) => {
    const n = findNumber(v);
    if (n != null) fontSizes.push(n);
  });
  collectColors(objects, ["color", "fontColor", "labelColor"], textColors);
  collectColors(vcObjects, ["color", "fontColor", "labelColor"], textColors);
  collectColors(objects, ["fill", "dataPoint", "fillColor", "foreground", "markerColor"], fillColors);
  collectColors(vcObjects, ["fill", "dataPoint", "fillColor", "foreground", "markerColor"], fillColors);

  // Title. Power BI stores the visual title in two places depending on the
  // visual generation:
  //   - Legacy visuals: objects.title[0]
  //   - New on-object format (2023+ Card, etc.): vcObjects.title[0]
  // We read both and prefer whichever has explicit text/show.
  // Defaults: if no title entry exists at all → assume ON (Power BI default
  // for chart visuals). For visuals that don't auto-title (cards, slicers)
  // the visualTitle rule already requires explicit text.
  const legacyTitleEntry = objects.title?.[0] ?? null;
  const vcTitleEntry = vcObjects.title?.[0] ?? null;
  const legacyTitleObj = legacyTitleEntry?.properties ?? null;
  const vcTitleObj = vcTitleEntry?.properties ?? null;

  const legacyText = legacyTitleObj ? findText(legacyTitleObj.text) : null;
  const vcText = vcTitleObj ? findText(vcTitleObj.text) : null;
  const titleText = vcText ?? legacyText;

  const legacyShow = findBool(legacyTitleObj?.show ?? legacyTitleEntry?.show ?? null);
  const vcShow = findBool(vcTitleObj?.show ?? vcTitleEntry?.show ?? null);
  // Visible if either source explicitly says ON, or has text; OFF only if all
  // present sources say false.
  let titleVisible: boolean;
  if (vcShow != null || legacyShow != null) {
    titleVisible = (vcShow === true) || (legacyShow === true) ||
      (vcShow !== false && legacyShow !== false && !!titleText);
  } else {
    titleVisible = true;
  }
  if (titleText) titleVisible = titleVisible || true;

  const titleFontPt =
    (vcTitleObj ? findNumber(vcTitleObj.fontSize) : null) ??
    (legacyTitleObj ? findNumber(legacyTitleObj.fontSize) : null);
  const titleColor =
    (vcTitleObj ? findColor(vcTitleObj.fontColor ?? vcTitleObj.color) : null) ??
    (legacyTitleObj ? findColor(legacyTitleObj.fontColor ?? legacyTitleObj.color) : null);
  if (titleFontPt != null) fontSizes.push(titleFontPt);
  if (titleColor) textColors.add(titleColor);

  // Labels / categories / axes
  const labelObj = objects.labels?.[0]?.properties ?? null;
  const labelFontPt = labelObj ? findNumber(labelObj.fontSize) : null;
  const labelColor = labelObj ? findColor(labelObj.color) : null;
  if (labelFontPt != null) fontSizes.push(labelFontPt);
  if (labelColor) textColors.add(labelColor);

  const catObj = objects.categoryAxis?.[0]?.properties ?? objects.categoryLabels?.[0]?.properties ?? null;
  const categoryColor = catObj ? findColor(catObj.color ?? catObj.labelColor) : null;
  const catFontPt = catObj ? findNumber(catObj.fontSize) : null;
  if (catFontPt != null) fontSizes.push(catFontPt);
  if (categoryColor) textColors.add(categoryColor);

  const axisObj = objects.valueAxis?.[0]?.properties ?? null;
  const axisColor = axisObj ? findColor(axisObj.color ?? axisObj.labelColor) : null;
  const axisFontPt = axisObj ? findNumber(axisObj.fontSize) : null;
  if (axisFontPt != null) fontSizes.push(axisFontPt);
  if (axisColor) textColors.add(axisColor);

  // Axis titles. Power BI stores per-axis "showAxisTitle" inside categoryAxis
  // (X, for column charts) and valueAxis (Y). Visuals without axes (cards,
  // slicers, pies, treemaps, KPIs, gauges, tables/matrices, maps) shouldn't
  // be flagged.
  const AXIS_VISUALS = [
    "barChart","clusteredBarChart","stackedBarChart","hundredPercentStackedBarChart",
    "columnChart","clusteredColumnChart","stackedColumnChart","hundredPercentStackedColumnChart",
    "lineChart","areaChart","stackedAreaChart","scatterChart","ribbonChart","waterfallChart",
    "lineStackedColumnComboChart","lineClusteredColumnComboChart","funnel",
  ];
  const hasAxes = AXIS_VISUALS.includes(String(single.visualType ?? ""));
  const readAxisTitleShow = (obj: any): boolean | null => {
    if (!obj) return null;
    const t = obj.showAxisTitle ?? obj.axisTitle ?? null;
    if (t == null) return null;
    const b = findBool(t);
    if (b != null) return b;
    // Some files nest title visibility one level deeper.
    return findBool(t?.show) ?? null;
  };
  const xAxisTitleVisible = hasAxes ? readAxisTitleShow(catObj) : null;
  const yAxisTitleVisible = hasAxes ? readAxisTitleShow(axisObj) : null;

  // Background
  const bgObj = vcObjects.background?.[0]?.properties ?? objects.background?.[0]?.properties ?? null;
  const background = bgObj ? findColor(bgObj.color) : null;

  // Alt text  -  Power BI stores it under vcObjects.general[0].properties.altText
  const altSources = [
    vcObjects.general?.[0]?.properties?.altText,
    objects.general?.[0]?.properties?.altText,
    single.altText,
    visualContainer.altText,
  ];
  let altText: string | null = null;
  for (const a of altSources) {
    const t = findText(a);
    if (t) {
      altText = t;
      break;
    }
  }

  const visualType = single.visualType ?? single.type ?? "unknown";

  // A visual-group container's author-given name lives on the raw PBIR JSON
  // (`visualGroup.displayName`), carried through unchanged as rawVisual by
  // the PBIR split-file loader. It has no equivalent in objects/vcObjects,
  // so it can't be picked up by the generic title extraction above.
  const groupDisplayName =
    String(visualType).toLowerCase() === "visualgroup"
      ? (findText(visualContainer.rawVisual?.visualGroup?.displayName) ?? null)
      : null;

  // Detect human-readable text inside shapes/textboxes/images. Power BI
  // stores rich-text content as runs of `textRuns[].value` inside
  // `paragraphs[]`, which can live under several object keys depending on
  // visual type (textbox uses `general.paragraphs`, shapes use
  // `shape.text`/`text.paragraphs`, etc.). We sweep recursively for any
  // non-empty `textRuns[*].value` or `paragraphs[*].textRuns[*].value`.
  const collectedTextRuns = collect(objects, (k) => k === "textRuns")
    .flat()
    .map((r: any) => (r && typeof r.value === "string" ? r.value : ""))
    .filter((s: string) => s.trim().length > 0);
  const hasText = collectedTextRuns.length > 0;

  // Field bindings. Power BI stores per-role projections under
  // `singleVisual.projections` as `{ Role: [{ queryRef: "Table.Col" }, ...] }`,
  // and the canonical field list under `prototypeQuery.Select[*].Name`.
  const fieldSet = new Set<string>();
  const cleanRef = (s: any): string | null => {
    if (typeof s !== "string") return null;
    let v = s.trim();
    if (!v) return null;
    // queryRefs look like "Sales.Amount" or "Sales[Amount]"  -  normalise to
    // "Sales[Amount]" for readability.
    const dot = v.match(/^([^.\[]+)\.(.+)$/);
    if (dot) v = `${dot[1]}[${dot[2]}]`;
    return v;
  };
  // (a) projections: `{ Role: [{ queryRef: "Sales.Amount" }, ...] }`.
  const projections = single.projections;
  if (projections && typeof projections === "object") {
    for (const role of Object.keys(projections)) {
      const arr = projections[role];
      if (Array.isArray(arr)) {
        for (const p of arr) {
          const ref = cleanRef(p?.queryRef ?? p?.Name ?? p?.name);
          if (ref) fieldSet.add(ref);
        }
      }
    }
  }
  // (b) prototypeQuery.Select entries  -  try Column/Measure.Property first
  //     (most reliable), falling back to the friendly .Name alias.
  const proto = single.prototypeQuery;
  const fromExpr = (node: any): string | null => {
    if (!node || typeof node !== "object") return null;
    const col = node.Column ?? node.Measure ?? null;
    if (col?.Property) {
      const src = col.Expression?.SourceRef?.Source ?? col.Expression?.SourceRef?.Entity ?? null;
      const entity = src && Array.isArray(proto?.From)
        ? (proto.From.find((f: any) => f.Name === src)?.Entity ?? src)
        : src;
      return entity ? `${entity}[${col.Property}]` : `[${col.Property}]`;
    }
    if (node.Aggregation?.Expression) return fromExpr(node.Aggregation.Expression);
    return null;
  };
  if (proto?.Select && Array.isArray(proto.Select)) {
    for (const s of proto.Select) {
      const fromCol = fromExpr(s);
      if (fromCol) { fieldSet.add(fromCol); continue; }
      const ref = cleanRef(s?.Name);
      if (ref) fieldSet.add(ref);
    }
  }
  // (c) Last-resort sweep: any nested object with a `queryRef` string.
  if (fieldSet.size === 0) {
    collect(single, (k, val) => k === "queryRef" && typeof val === "string").forEach((v: any) => {
      const ref = cleanRef(v);
      if (ref) fieldSet.add(ref);
    });
  }
  const fields = Array.from(fieldSet);

  const x = Number(visualContainer.x ?? 0);
  const y = Number(visualContainer.y ?? 0);
  const w = Number(visualContainer.width ?? 0);
  const h = Number(visualContainer.height ?? 0);
  const z = Number(visualContainer.z ?? idx);

  // Tab order extraction. Power BI stores it under
  //   singleVisual.objects.general[0].properties.tabOrder
  // as a numeric Literal. -1 means "hidden from tab order" (decorative).
  // Also fall back to vcObjects.general or a top-level container field.
  const tabOrderState = extractTabOrderState(
    ...layoutPositionTabOrderSources(visualContainer, cfg),
    objects.general?.[0]?.properties?.tabOrder,
    vcObjects.general?.[0]?.properties?.tabOrder,
    visualContainer.tabOrder,
    single.tabOrder,
    visualContainer.config?.tabOrder,
    visualContainer,
    single,
  );

  // Decorative = pure shape/image with no text, no alt text, no fields, no title text.
  const typeLc = String(visualType).toLowerCase();
  const isShapeOrImage = ["shape", "image"].some((p) => typeLc.includes(p)) ||
    ["text", "label", "header", "background"].includes(typeLc);
  const isDecorative = isShapeOrImage && !hasText && !altText && fieldSet.size === 0 && !titleText;

  const visualId = String(visualContainer.id ?? single.name ?? visualContainer.name ?? `v${idx}`);
  const displayName = titleText ?? String(single.name ?? visualContainer.name ?? `Visual ${idx + 1}`);

  return {
    visualId,
    id: visualId,
    name: String(single.name ?? visualContainer.name ?? `Visual ${idx + 1}`),
    displayName,
    type: String(visualType),
    x, y, width: w, height: h, w, h, z,
    altText,
    titleVisible,
    titleText,
    titleFontPt,
    titleColor,
    labelFontPt,
    labelColor,
    categoryColor,
    axisColor,
    background,
    hasAxes,
    xAxisTitleVisible,
    yAxisTitleVisible,
    fontSizes,
    textColors: Array.from(textColors),
    fillColors: Array.from(fillColors),
    hasText,
    fields,
    tabOrder: tabOrderState.isHiddenFromTabOrder ? -1 : tabOrderState.tabOrderIndex,
    tabOrderIndex: tabOrderState.tabOrderIndex,
    isHiddenFromTabOrder: tabOrderState.isHiddenFromTabOrder,
    isDecorative,
    groupDisplayName,
    // Resolved to a real group id (or left null) by extractPage's group-
    // linking pass below, once every container's own id is known - a raw
    // visualContainer only carries the *name* it was authored under
    // (`parentGroupName`), not the id extractVisual assigns above.
    parentGroupId: null,
    // Filled in by assignTabOrderRanks, called by extractPage on this whole
    // page's freshly-extracted visuals, before anything else (including
    // normalisePowerBiLayoutTabOrder) has a chance to touch tabOrderIndex.
    tabOrderRank: null,
    rawObjects: { objects, vcObjects, config: cfg, visualContainer },
  };
}

/**
 * Computes `tabOrderRank` for every non-hidden, tabOrder-authored visual on a
 * page, in one whole-page pass: sort descending by the visual's UNTOUCHED raw
 * tabOrderIndex (largest raw value = rank 1, per the confirmed real-world
 * rule "a higher raw tabOrder value is earlier in the tab sequence" - see the
 * doc comment on ParsedVisual.tabOrderRank), and number the result 1..N.
 * Must run before normalisePowerBiLayoutTabOrder, which mutates
 * tabOrder/tabOrderIndex under a separate, narrower heuristic - this function
 * and that one are intentionally independent, so tabOrderRank means the same
 * thing ("1 = first") whether or not that later step ends up firing.
 * A visual with no rank (hidden, or no authored tabOrder) is returned
 * unchanged, with tabOrderRank left at whatever it already was (null, coming
 * out of extractVisual).
 */
export function assignTabOrderRanks(visuals: ParsedVisual[]): ParsedVisual[] {
  const rankedIds = visuals
    .filter((v) => !v.isHiddenFromTabOrder && v.tabOrderIndex != null)
    .sort((a, b) => (b.tabOrderIndex as number) - (a.tabOrderIndex as number))
    .map((v) => v.id);
  const rankById = new Map<string, number>(rankedIds.map((id, i) => [id, i + 1]));
  return visuals.map((v) => {
    const rank = rankById.get(v.id);
    return rank != null ? { ...v, tabOrderRank: rank } : v;
  });
}

/**
 * Resolves every visual's `x`/`y` from group-relative to page-absolute, by
 * walking each visual's `parentGroupId` chain and summing each ancestor
 * group's own (already-resolved) position. A visual with no parentGroupId is
 * already page-absolute and is returned unchanged. Handles arbitrary nesting
 * depth (a group inside a group) and is defensive against a cyclic parent
 * chain, which should never occur but would otherwise recurse forever.
 *
 * Nothing downstream is expected to want the pre-resolution, group-relative
 * x/y, so this overwrites x/y in place (on new visual objects) rather than
 * adding separate "absolute" fields - every rule that reads v.x/v.y
 * (clutter, tab order, target size, ...) automatically gets correct,
 * page-absolute coordinates. Do not "fix" x/y back to group-relative later:
 * post-resolution, x/y are always page-absolute.
 */
export function resolveAbsolutePositions(visuals: ParsedVisual[]): ParsedVisual[] {
  const byId = new Map(visuals.map((v) => [v.id, v] as const));
  const resolvedX = new Map<string, number>();
  const resolvedY = new Map<string, number>();
  const inProgress = new Set<string>();

  function resolve(v: ParsedVisual): { x: number; y: number } {
    const cached = resolvedX.has(v.id) ? { x: resolvedX.get(v.id)!, y: resolvedY.get(v.id)! } : null;
    if (cached) return cached;
    const parent = v.parentGroupId != null ? byId.get(v.parentGroupId) : undefined;
    // No parent, parent not found (e.g. parentGroupName referenced a group
    // that doesn't exist on this page), or a cycle  ->  treat x/y as already
    // page-absolute.
    if (!parent || inProgress.has(v.id)) {
      resolvedX.set(v.id, v.x);
      resolvedY.set(v.id, v.y);
      return { x: v.x, y: v.y };
    }
    inProgress.add(v.id);
    const parentAbs = resolve(parent);
    const x = parentAbs.x + v.x;
    const y = parentAbs.y + v.y;
    inProgress.delete(v.id);
    resolvedX.set(v.id, x);
    resolvedY.set(v.id, y);
    return { x, y };
  }

  return visuals.map((v) => {
    const { x, y } = resolve(v);
    if (x === v.x && y === v.y) return v;
    return { ...v, x, y };
  });
}

export function extractPage(section: any, canvasW: number, canvasH: number): ParsedPage {
  const cfg = expand(section.config) ?? {};
  const visualContainers = (section.visualContainers ?? []).map((vc: any) => ({
    ...vc,
    config: expand(vc.config),
    filters: expand(vc.filters),
    query: expand(vc.query),
  }));

  const pageW = Number(section.width ?? canvasW);
  const pageH = Number(section.height ?? canvasH);

  // "Page title"  -  Power BI doesn't have a native page title, so we treat
  // a top-of-canvas text/card visual whose y is in the top 10% as a page title.
  let pageTitleVisible = false;
  for (const vc of visualContainers) {
    const single = vc.config?.singleVisual;
    if (!single) continue;
    const isText = ["textbox", "card", "multiRowCard"].includes(single.visualType);
    if (isText && Number(vc.y) < pageH * 0.1) {
      pageTitleVisible = true;
      break;
    }
  }

  // Explicitly typed (rather than left to inference) because `visualContainers`
  // is `any` (it comes from a `section: any` input) - without this annotation
  // every array method called on the result below would itself type as `any`
  // and their callback parameters would trip noImplicitAny.
  const extractedVisuals: ParsedVisual[] = visualContainers.map((vc: any, i: number) => extractVisual(vc, i));

  // tabOrderRank must be computed from the pristine, just-extracted raw
  // tabOrderIndex values, in one whole-page pass, before anything below
  // (notably normalisePowerBiLayoutTabOrder, at the very end of this
  // function) gets a chance to rewrite tabOrderIndex under its own, narrower
  // heuristic. Order/indices are preserved 1:1, so `visualContainers[i]`
  // below still lines up with `rankedVisuals[i]`.
  const rankedVisuals = assignTabOrderRanks(extractedVisuals);

  // Link each visual to the id of the group container it's nested inside, by
  // name: PBIR stores nesting as `parentGroupName` on the child (carried
  // through onto the raw visualContainer by the object spread above, for
  // both the modern split-file PBIR path and a hypothetical legacy layout
  // that used the same field), which names the *authoring* name of the
  // parent group container (its own `name`), not the id extractVisual
  // assigns. Build a name -> id lookup from every visualGroup container on
  // this page, then resolve every child's parentGroupId against it. A
  // parentGroupName with no matching group on this page (e.g. a stale/
  // malformed reference) resolves to null rather than throwing, so a single
  // bad reference degrades to "treat as top-level" instead of failing parse.
  const groupIdByName = new Map<string, string>();
  rankedVisuals.forEach((v, i) => {
    if (String(v.type).toLowerCase() === "visualgroup") {
      const rawName = String(visualContainers[i]?.name ?? v.name);
      groupIdByName.set(rawName, v.id);
    }
  });
  const linkedVisuals = rankedVisuals.map((v, i) => {
    const rawParentName = visualContainers[i]?.parentGroupName;
    if (rawParentName == null) return v;
    const parentGroupId = groupIdByName.get(String(rawParentName)) ?? null;
    return parentGroupId ? { ...v, parentGroupId } : v;
  });

  return {
    id: String(section.name ?? section.id ?? "page"),
    name: String(section.name ?? "page"),
    displayName: String(section.displayName ?? section.name ?? "Page"),
    width: pageW,
    height: pageH,
    hidden: Boolean(cfg?.visibility === 1 || section.visibility === 1),
    pageTitleVisible,
    visuals: normalisePowerBiLayoutTabOrder(resolveAbsolutePositions(linkedVisuals)),
  };
}

export async function parsePbix(file: File): Promise<ParsedReport> {
  if (!file) throw new PBIXParseError("No file provided");
  if (!file.name.toLowerCase().endsWith(".pbix")) {
    throw new PBIXParseError("File must be a .pbix file");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    throw new PBIXParseError("Could not open .pbix  -  file may be corrupted or password-protected.");
  }

  // Find the layout entry. Newer PBIX use "Report/Layout"; some variants nest it.
  const layoutEntry =
    zip.file("Report/Layout") ||
    zip.file(/Report\/Layout$/i)[0] ||
    zip.file(/Layout$/i).find((f) => f.name.toLowerCase().includes("report"));

  if (!layoutEntry) {
    throw new PBIXParseError("No Report/Layout found. This PBIX format isn't supported (it may be a template or encrypted).");
  }

  const buf = await layoutEntry.async("uint8array");
  const text = utf16LeDecode(buf);
  const layout = tryParseJSON<any>(text) ?? tryParseJSON<any>(text.replace(/^\uFEFF/, ""));
  if (!layout) throw new PBIXParseError("Layout JSON could not be parsed.");

  const canvasW = Number(layout?.config ? expand(layout.config)?.settings?.canvasSize?.width : 0) || Number(layout?.layoutOptimization === 0 ? 1280 : 0) || 1280;
  const canvasH = Number(layout?.config ? expand(layout.config)?.settings?.canvasSize?.height : 0) || 720;

  // Theme colours
  const cfg = expand(layout.config) ?? {};
  const theme = cfg?.themeCollection?.baseTheme ?? cfg?.theme ?? {};
  const themeColors: string[] = [];
  collect(theme, (k) => k === "dataColors" || k === "background" || k === "foreground" || k === "tableAccent").forEach((v) => {
    if (Array.isArray(v)) v.forEach((c) => typeof c === "string" && themeColors.push(c));
    else if (typeof v === "string") themeColors.push(v);
  });

  const sections = layout.sections ?? [];
  // Only analyze visible tabs  -  hidden pages aren't seen by end users.
  const pages = sections
    .map((s: any) => extractPage(s, canvasW, canvasH))
    .filter((p: ParsedPage) => !p.hidden);

  return {
    fileName: file.name,
    fileSize: file.size,
    canvasWidth: canvasW,
    canvasHeight: canvasH,
    themeColors: Array.from(new Set(themeColors)).slice(0, 32),
    pages,
  };
}

/** Build a ParsedReport from an already-parsed Power BI layout object.
 *  Shared by the PBIX parser (Report/Layout) and the PBIR parser (legacy
 *  Layout file or synthesised from split-file PBIR projects). */
export function buildReportFromLayout(
  layout: any,
  fileName: string,
  fileSize: number,
  opts?: { includeHidden?: boolean },
): ParsedReport {
  const canvasW =
    Number(layout?.config ? expand(layout.config)?.settings?.canvasSize?.width : 0) ||
    Number(layout?.layoutOptimization === 0 ? 1280 : 0) ||
    1280;
  const canvasH =
    Number(layout?.config ? expand(layout.config)?.settings?.canvasSize?.height : 0) || 720;

  const cfg = expand(layout.config) ?? {};
  const theme = cfg?.themeCollection?.baseTheme ?? cfg?.theme ?? {};
  const themeColors: string[] = [];
  collect(theme, (k) => k === "dataColors" || k === "background" || k === "foreground" || k === "tableAccent").forEach((v) => {
    if (Array.isArray(v)) v.forEach((c) => typeof c === "string" && themeColors.push(c));
    else if (typeof v === "string") themeColors.push(v);
  });

  const sections = layout.sections ?? [];
  const pages = sections
    .map((s: any) => extractPage(s, canvasW, canvasH))
    .filter((p: ParsedPage) => opts?.includeHidden || !p.hidden);

  return {
    fileName,
    fileSize,
    canvasWidth: canvasW,
    canvasHeight: canvasH,
    themeColors: Array.from(new Set(themeColors)).slice(0, 32),
    pages,
  };
}
