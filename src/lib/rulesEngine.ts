// Modular accessibility rules engine.
// Input: ParsedReport from pbixParser. Output: AnalysisResult.

import type { ParsedReport, ParsedVisual, ParsedPage } from "./pbixParser";
import { evaluateContrast } from "./contrastUtils";
import { findCollisions } from "./colourblindUtils";
import { evaluateFontSize, minFontPt } from "./fontScaling";
import { clutterIndex } from "./clutterIndex";

export type Severity = "fail" | "warn" | "pass" | "info";
export type Category =
  | "contrast"
  | "colourblind"
  | "altText"
  | "clutter"
  | "pageTitles"
  | "visualTitles"
  | "axisTitles"
  | "fontScaling"
  | "tabOrder"
  | "targetSize"
  | "other";

// Which checks the user wants to run. All true = run everything.
// `colourblind` is now a UI toggle (not an automated audit rule): when on,
// the Results page surfaces an embedded Colour-Blindness Simulator so users
// can verify a screenshot of the report alongside the audit findings.
export interface CheckSelection {
  contrast: boolean;
  colourblind: boolean;
  altText: boolean;
  clutter: boolean;
  pageTitles: boolean;
  visualTitles: boolean;
  axisTitles: boolean;
  fontScaling: boolean;
  tabOrder: boolean;
  targetSize: boolean;
  customVisuals: boolean;
}

export const ALL_CHECKS: CheckSelection = {
  contrast: true,
  // Colour-blindness is NOT an automated audit rule (PBIX colour storage
  // is too varied for a reliable static parse). When on, this surfaces the
  // embedded Colour-Blindness Simulator on the Results page.
  colourblind: true,
  altText: true,
  clutter: true,
  pageTitles: true,
  visualTitles: true,
  axisTitles: true,
  fontScaling: true,
  tabOrder: true,
  targetSize: true,
  customVisuals: true,
};

export interface Issue {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  detail: string;
  why: string;
  fix: string;
  pageId?: string;
  visualId?: string;
}

export interface VisualReport {
  visual: ParsedVisual;
  issues: Issue[];
  contrastChecks: { what: string; fg: string; bg: string; ratio: number; level: string; passAA: boolean }[];
}

export interface PageReport {
  page: ParsedPage;
  issues: Issue[];
  visuals: VisualReport[];
  clutter: ReturnType<typeof clutterIndex>;
}

export interface AnalysisResult {
  fileName: string;
  fileSize: number;
  canvasWidth: number;
  canvasHeight: number;
  requiredMinPt: number;
  /** When true, the Results page surfaces an embedded Colour-Blindness Simulator alongside the audit. */
  runCvdSimulator?: boolean;
  /** When true, the Results page surfaces the advisory Custom Visuals Warning card. */
  runCustomVisualsCheck?: boolean;
  pages: PageReport[];
  summary: {
    pageCount: number;
    visualCount: number;
    issueCount: number;
    byCategory: Record<Category, { fail: number; warn: number; pass: number }>;
    overallScore: number; // 0-100
  };
}

const PLACEHOLDER_ALT = [
  "alt text",
  "enter alt text",
  "type alt text",
  "image",
  "visual",
  "chart",
  "untitled",
];

// Map Power BI internal visual type ids to human-friendly chart names.
const FRIENDLY_TYPES: Record<string, string> = {
  barChart: "Bar chart",
  clusteredBarChart: "Clustered bar chart",
  stackedBarChart: "Stacked bar chart",
  hundredPercentStackedBarChart: "100% stacked bar chart",
  columnChart: "Column chart",
  clusteredColumnChart: "Clustered column chart",
  stackedColumnChart: "Stacked column chart",
  hundredPercentStackedColumnChart: "100% stacked column chart",
  lineChart: "Line chart",
  areaChart: "Area chart",
  stackedAreaChart: "Stacked area chart",
  lineStackedColumnComboChart: "Line + stacked column",
  lineClusteredColumnComboChart: "Line + clustered column",
  pieChart: "Pie chart",
  donutChart: "Donut chart",
  funnel: "Funnel chart",
  scatterChart: "Scatter chart",
  treemap: "Treemap",
  map: "Map",
  filledMap: "Filled map",
  shapeMap: "Shape map",
  azureMap: "Azure map",
  card: "Card",
  cardVisual: "Card",
  multiRowCard: "Multi-row card",
  cardStrip: "KPI card strip",
  kpi: "KPI",
  gauge: "Gauge",
  tableEx: "Table",
  pivotTable: "Matrix",
  matrix: "Matrix",
  slicer: "Slicer",
  advancedSlicerVisual: "Slicer",
  listSlicer: "List slicer",
  textbox: "Text box",
  text: "Text box",
  image: "Image",
  shape: "Shape",
  basicShape: "Shape",
  actionButton: "Button",
  pageNavigator: "Page navigator",
  bookmarkNavigator: "Bookmark navigator",
  decompositionTreeVisual: "Decomposition tree",
  ribbonChart: "Ribbon chart",
  waterfallChart: "Waterfall chart",
  qnaVisual: "Q&A",
  visualGroup: "Visual group",
};

export function friendlyType(t: string): string {
  return FRIENDLY_TYPES[t] ?? t.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

// Human-readable label for a visual. Always include the visual type, plus
// either the visible title or  -  when there is no title  -  the bound fields,
// so authors can tell apart multiple visuals of the same type. Examples:
//   `Bar chart "Sales by region"`
//   `Slicer · fields: Date[Year], Product[Category]`
//   `Card (no title, no fields)`
// Power BI's internal `name` (a GUID-like id) is intentionally NOT used  - 
// it isn't visible to authors in Power BI Desktop and adds noise.
export function describeVisual(v: ParsedVisual): string {
  const type = friendlyType(v.type);
  const title = (v.titleText || v.groupDisplayName)?.trim();
  if (title && title.length > 0) return `${type} "${title}"`;
  if ((v.type ?? "").toLowerCase().trim() === "visualgroup") return `${type} (unnamed)`;
  const fields = (v.fields ?? []).slice(0, 3);
  if (fields.length > 0) {
    const more = (v.fields?.length ?? 0) > fields.length ? ` +${(v.fields!.length - fields.length)} more` : "";
    return `${type} · fields: ${fields.join(", ")}${more}`;
  }
  return `${type} (no title, no fields)`;
}

// Type-pattern helpers used by the rules below.
function typeIs(v: ParsedVisual, ...patterns: string[]): boolean {
  const t = (v.type ?? "").toLowerCase().trim();
  return patterns.some((p) => t.includes(p));
}

// A visual-group container (a layout grouping of other visuals, no data of
// its own). Power BI Desktop DOES offer it a static alt-text field (Format
// pane → Properties) - screen reader focus lands on the group before its
// contents, so it still needs one - but it takes no chart-style title, so
// it's out of scope for the title rule below - distinct from "pure
// decoration", which is about shapes/images that happen to carry no content.
function isVisualGroup(v: ParsedVisual): boolean {
  return (v.type ?? "").toLowerCase().trim() === "visualgroup";
}

// Visual types that carry no data of their own and shouldn't be counted as a
// "data visualisation" for clutter, or (for the shape/textbox/image subset)
// serve as an overlay "base" for tab-order layout inference. A visual-group
// container's own box fully contains its children's boxes by construction,
// so counting it here would double-count every visual inside it and produce
// phantom overlaps - it must never be treated as a data visual.
const NON_DATA_PATTERNS = ["shape", "textbox", "image", "button", "navigator", "slicer"];
const NON_DATA_EXACT = new Set(["text", "label", "header", "background", "visualgroup"]);

function isDataVisual(v: ParsedVisual): boolean {
  const t = (v.type ?? "").toLowerCase().trim();
  if (!t || t === "unknown") return false;
  if (NON_DATA_EXACT.has(t)) return false;
  return !NON_DATA_PATTERNS.some((p) => t.includes(p));
}

// "Pure decoration" = a shape/textbox/image visual with no text inside it.
// These are visual scaffolding (dividers, background panels, decorative
// images) and don't need alt text. As soon as a shape carries text, screen
// reader users need an alt-text equivalent. Visual groups are never pure
// decoration - see isVisualGroup above - they get their own alt-text checks
// via altTextRule below, same as any other visual.
function isPureDecoration(v: ParsedVisual): boolean {
  const t = (v.type ?? "").toLowerCase().trim();
  if (!t) return true;
  if (new Set(["text", "label", "header", "background"]).has(t)) return !v.hasText;
  const decorative = ["shape", "textbox", "image"].some((p) => t.includes(p));
  return decorative && !v.hasText;
}

// Visuals that don't take a chart-style title (shapes, buttons, nav, slicers,
// text boxes, images). Title-rule scope is narrower than alt-text scope.
// Visuals that don't take a chart-style title (pure shapes, text boxes,
// images, buttons, page/bookmark navigators). Slicers and all data charts
// DO need a visible title so users  -  and screen-reader users  -  know what
// the control filters or the chart shows.
function skipTitleCheck(v: ParsedVisual): boolean {
  return isVisualGroup(v)
    || typeIs(v, "shape", "textbox", "image", "button", "navigator")
    || ["text", "label", "header", "background"].includes((v.type ?? "").toLowerCase().trim());
}

// ---- Per-visual rules ----

// Group alt text can only ever be a static string in Power BI - unlike a
// chart, there's no field/measure binding available for it - so the fix
// text must not suggest one. Steer authors toward describing the group and
// roughly how many items it holds, without a literal count: an exact number
// goes stale the moment a visual is added to or removed from the group.
const GROUP_ALT_FIX = {
  missing: "In Power BI, select the group → Format pane → Properties → Alt text. Describe what the group represents and roughly how many items it holds - skip an exact count, since that can go stale as visuals are added or removed.",
  tooShort: "Describe what the group represents and roughly how many items it holds, in a full sentence - skip an exact count, since that can go stale.",
  placeholder: "Replace with a description of what the group represents and roughly how many items it holds - skip an exact count, since that can go stale.",
};

function altTextRule(v: ParsedVisual): Issue | null {
  // Only skip pure decoration (empty shapes, textboxes, images). Buttons,
  // navigators, slicers, shapes-containing-text, and visual groups DO need
  // alt text so screen reader users get an equivalent of what sighted users
  // see (for a group, that a group exists at all and roughly what it holds).
  if (isPureDecoration(v)) return null;
  const isGroup = isVisualGroup(v);
  if (!v.altText) {
    return {
      id: `${v.id}-alt-missing`,
      category: "altText",
      severity: "fail",
      title: "Missing alt text",
      detail: `${describeVisual(v)} has no alt text.`,
      why: "Screen reader users rely on alt text to understand non-text visuals.",
      fix: isGroup
        ? GROUP_ALT_FIX.missing
        : "In Power BI, select the visual → Format pane → General → Alt text. Describe what the visual shows and the key insight.",
      visualId: v.id,
    };
  }
  const t = v.altText.trim().toLowerCase();
  if (t.length < 4) {
    return {
      id: `${v.id}-alt-empty`,
      category: "altText",
      severity: "fail",
      title: "Empty alt text",
      detail: `${describeVisual(v)} has alt text that is too short (${v.altText.length} chars).`,
      why: "Screen readers will announce nothing useful for very short alt text.",
      fix: isGroup
        ? GROUP_ALT_FIX.tooShort
        : "Write a descriptive sentence covering both the chart type and the insight it conveys.",
      visualId: v.id,
    };
  }
  if (PLACEHOLDER_ALT.some((p) => t === p || t.startsWith(p))) {
    return {
      id: `${v.id}-alt-placeholder`,
      category: "altText",
      severity: "fail",
      title: "Placeholder alt text",
      detail: `${describeVisual(v)} uses placeholder alt text: "${v.altText}"`,
      why: "Placeholder text gives users nothing meaningful and signals the field was skipped.",
      fix: isGroup ? GROUP_ALT_FIX.placeholder : "Replace with a concrete description of the data and trend shown.",
      visualId: v.id,
    };
  }
  return null;
}

// Visual types that do NOT get an auto-generated title from Power BI when
// the user leaves the title field blank  -  slicers and cards display nothing
// in their title bar unless the author types something. For data charts
// (bar/column/line/etc.) Power BI fills the title from the bound field, so
// an absent titleText is acceptable there.
function requiresExplicitTitleText(v: ParsedVisual): boolean {
  const t = (v.type ?? "").toLowerCase().trim();
  return [
    "slicer", "advancedslicervisual", "listslicer",
    "card", "cardvisual", "multirowcard", "kpi", "gauge",
  ].some((p) => t.includes(p));
}

function visualTitleRule(v: ParsedVisual): Issue | null {
  // Shapes, text boxes, images, buttons and navigators don't take a chart-
  // style title. Slicers and all data charts DO.
  if (skipTitleCheck(v)) return null;
  if (!v.titleVisible) {
    return {
      id: `${v.id}-title-off`,
      category: "visualTitles",
      severity: "warn",
      title: "Visual title turned off",
      detail: `${describeVisual(v)} has its title disabled.`,
      why: "Visible titles help all users  -  and especially low-vision users  -  orient themselves on a page.",
      fix: "Format pane → Title → toggle On, and provide a short, specific title.",
      visualId: v.id,
    };
  }
  // Empty authored title string  -  flag everywhere.
  if (v.titleText != null && v.titleText.trim().length === 0) {
    return {
      id: `${v.id}-title-empty`,
      category: "visualTitles",
      severity: "warn",
      title: "Empty visual title",
      detail: `${describeVisual(v)} has its title turned on but no text.`,
      why: "An empty title bar gives sighted users nothing to read and screen readers nothing to announce.",
      fix: "Format pane → Title → type a short, specific title (for slicers, name the field being filtered).",
      visualId: v.id,
    };
  }
  // Slicers, cards, KPIs and gauges don't auto-generate a title from the
  // bound field. If no titleText was authored, there's literally no title
  // displayed  -  flag it.
  if (!v.titleText && requiresExplicitTitleText(v)) {
    return {
      id: `${v.id}-title-missing`,
      category: "visualTitles",
      severity: "warn",
      title: "Missing visual title",
      detail: `${describeVisual(v)} has no title text. Slicers and cards don't auto-generate one, so nothing is shown.`,
      why: "Without a written title, sighted users have no label and screen readers announce nothing for the visual.",
      fix: "Format pane → Title → toggle On and type a short, specific title (for slicers, name the field being filtered).",
      visualId: v.id,
    };
  }
  return null;
}

// Power BI's "Group" action names a new group "Group", then "Group 1",
// "Group 2", ... An unnamed or default-named group is an authoring-hygiene
// concern (it's the Selection pane, an author-only surface, that this makes
// harder to navigate) rather than something a report *viewer*'s screen
// reader experience depends on - that's covered by the group's own alt text
// (see altTextRule/isPureDecoration above). Advisory-only: "info" severity,
// excluded from the score and from --fail-on, same as customVisuals.
// DEFAULT_GROUP_NAME only matches English default names (e.g. misses
// "Grupo 1") - known gap, tracked as a follow-up idea rather than fixed
// here. Scoped to visualGroup only; skipTitleCheck already keeps this out
// of visualTitleRule's path so the two never double-report the same visual.
const DEFAULT_GROUP_NAME = /^group\s*\d*$/i;

function visualGroupNameRule(v: ParsedVisual): Issue | null {
  if (!isVisualGroup(v)) return null;
  const name = v.groupDisplayName?.trim();
  if (!name) {
    return {
      id: `${v.id}-group-name-missing`,
      category: "visualTitles",
      severity: "info",
      title: "Group has no name",
      detail: `${describeVisual(v)} has no display name.`,
      why: "An unnamed group is harder for whoever maintains this report next to identify in the Selection pane - an authoring hygiene note, not something a report viewer's screen reader experience depends on.",
      fix: "Selection pane → double-click the group → give it a short, specific name describing its contents.",
      visualId: v.id,
    };
  }
  if (DEFAULT_GROUP_NAME.test(name)) {
    return {
      id: `${v.id}-group-name-default`,
      category: "visualTitles",
      severity: "info",
      title: "Group uses default name",
      detail: `${describeVisual(v)} still has Power BI's default group name.`,
      why: `A name like "${name}" tells the next person editing this report nothing about what the group contains - an authoring hygiene note, same as the missing-name case.`,
      fix: 'Selection pane → double-click the group → rename it to describe its contents (e.g. "Regional KPIs").',
      visualId: v.id,
    };
  }
  return null;
}

function axisTitleRule(v: ParsedVisual): Issue[] {
  if (!v.hasAxes) return [];
  const out: Issue[] = [];
  if (v.xAxisTitleVisible === false) {
    out.push({
      id: `${v.id}-x-axis-title-off`,
      category: "axisTitles",
      severity: "warn",
      title: "X-axis title turned off",
      detail: `${describeVisual(v)} has no visible X-axis title.`,
      why: "Axis titles tell readers  -  and screen-reader users  -  what the axis represents and the unit of measure.",
      fix: "Format pane → X-axis → Title → toggle On, and write a short label including the unit.",
      visualId: v.id,
    });
  }
  if (v.yAxisTitleVisible === false) {
    out.push({
      id: `${v.id}-y-axis-title-off`,
      category: "axisTitles",
      severity: "warn",
      title: "Y-axis title turned off",
      detail: `${describeVisual(v)} has no visible Y-axis title.`,
      why: "Axis titles tell readers  -  and screen-reader users  -  what the axis represents and the unit of measure.",
      fix: "Format pane → Y-axis → Title → toggle On, and write a short label including the unit.",
      visualId: v.id,
    });
  }
  return out;
}

function fontSizeRule(v: ParsedVisual, canvasW: number, canvasH: number): Issue | null {
  const required = minFontPt(canvasW, canvasH);
  const tooSmall = v.fontSizes.filter((p) => p > 0 && p < required);
  if (tooSmall.length === 0) return null;
  const min = Math.min(...tooSmall);
  return {
    id: `${v.id}-font-small`,
    category: "fontScaling",
    severity: "warn",
    title: `Font below minimum (${min}pt)`,
    detail: `${describeVisual(v)} has text at ${min}pt; minimum for this canvas is ${required}pt.`,
    why: "Below-minimum text becomes unreadable when the report is projected or viewed on larger displays.",
    fix: `Open the Format pane and bump every font size to at least ${required}pt (titles, labels, axes).`,
    visualId: v.id,
  };
}

function contrastChecksFor(v: ParsedVisual): { what: string; fg: string; bg: string; ratio: number; level: string; passAA: boolean }[] {
  const bg = v.background ?? "#FFFFFF";
  const checks: { what: string; fg: string; bg: string; ratio: number; level: string; passAA: boolean }[] = [];
  const pairs: [string, string | null, number | null][] = [
    ["Title", v.titleColor, v.titleFontPt],
    ["Data labels", v.labelColor, v.labelFontPt],
    ["Category labels", v.categoryColor, null],
    ["Axis labels", v.axisColor, null],
  ];
  for (const [label, fg, pt] of pairs) {
    if (!fg) continue;
    const isLarge = pt != null && pt >= 18;
    const r = evaluateContrast(fg, bg, isLarge);
    if (!r) continue;
    checks.push({ what: label, fg, bg, ratio: r.ratio, level: r.level, passAA: r.passAA });
  }
  return checks;
}

function contrastIssues(v: ParsedVisual, checks: ReturnType<typeof contrastChecksFor>): Issue[] {
  return checks
    .filter((c) => !c.passAA)
    .map<Issue>((c) => ({
      id: `${v.id}-contrast-${c.what}`,
      category: "contrast",
      severity: "fail",
      title: `Low contrast: ${c.what} (${c.ratio}:1)`,
      detail: `${c.what} colour ${c.fg} on background ${c.bg} fails WCAG AA (need ≥ 4.5:1, or 3:1 for large text).`,
      why: "Insufficient contrast makes text hard to read for users with low vision or in bright environments.",
      fix: "Pick a darker text colour (or lighter background) until contrast reaches at least 4.5:1. Try the WebAIM contrast checker.",
      visualId: v.id,
    }));
}

// Non-text contrast (WCAG 1.4.11, AA, 3:1)  -  applies to graphical objects
// needed to understand the content: data series fills/marks, and axis lines.
// We check each unique series fill colour against the visual background.
function nonTextContrastIssues(v: ParsedVisual): Issue[] {
  const bg = v.background ?? "#FFFFFF";
  const fills = Array.from(new Set(v.fillColors)).filter(Boolean);
  if (fills.length === 0) return [];
  const failing: { fg: string; ratio: number }[] = [];
  for (const fg of fills) {
    // Skip if the "fill" we picked up is actually the background itself.
    if (fg.toLowerCase() === bg.toLowerCase()) continue;
    const r = evaluateContrast(fg, bg, false);
    if (!r) continue;
    if (r.ratio < 3) failing.push({ fg, ratio: r.ratio });
  }
  if (failing.length === 0) return [];
  return failing.map<Issue>((f) => ({
    id: `${v.id}-noncontrast-${f.fg}`,
    category: "contrast",
    severity: "fail",
    title: `Low non-text contrast: ${f.fg} (${f.ratio}:1)`,
    detail: `Data colour ${f.fg} on background ${bg} fails WCAG 1.4.11 non-text contrast (need ≥ 3:1).`,
    why: "Bars, lines, points and other graphical objects must contrast at least 3:1 with their background so users with low vision can perceive them.",
    fix: "Darken the series colour (or lighten the background) until the ratio reaches 3:1. Avoid pale tints on white backgrounds.",
    visualId: v.id,
  }));
}

function colourblindIssues(v: ParsedVisual): Issue[] {
  const palette = Array.from(new Set(v.fillColors)).slice(0, 12);
  const issues: Issue[] = [];

  if (palette.length < 2) return issues;

  // Per-CVD-type pairwise collisions among the series colours. We do NOT
  // attempt a heuristic "red / amber / green" detection from the layout JSON:
  // PBIX colour storage is far too varied (theme tokens, conditional
  // formatting rules, dataPoint overrides, on-object themes) for a static
  // parse to reliably extract the *rendered* palette. Instead we surface a
  // recommendation in the UI to run the visual through the Colour Blindness
  // Simulator on a screenshot  -  the only way to verify the rendered output.
  const collisions = findCollisions(palette);
  if (collisions.length > 0) {
    const byType: Record<string, typeof collisions> = {};
    for (const c of collisions) (byType[c.type] ||= []).push(c);
    for (const [type, list] of Object.entries(byType)) {
      issues.push({
        id: `${v.id}-cvd-${type}`,
        category: "colourblind",
        severity: "warn",
        title: `Series indistinguishable for ${type}`,
        detail: `${list.length} colour pair${list.length > 1 ? "s" : ""} in ${describeVisual(v)} collide under ${type} simulation.`,
        why: "Roughly 8% of men and 0.5% of women have some form of colour blindness.",
        fix: "Use a colourblind-safe palette (Okabe-Ito, viridis), add patterns/markers, or label series directly so meaning isn't carried by hue alone.",
        visualId: v.id,
      });
    }
  }
  return issues;
}

// ---- Page rule ----

function pageTitleRule(p: ParsedPage): Issue | null {
  if (p.pageTitleVisible) return null;
  return {
    id: `${p.id}-page-title-missing`,
    category: "pageTitles",
    severity: "warn",
    title: "No visible page title",
    detail: `Page "${p.displayName}" has no text/card visual near the top acting as a page title.`,
    why: "A clear page title anchors the reader and is announced first by screen readers.",
    fix: "Add a Text box at the top of the page with the page name as a heading.",
    pageId: p.id,
  };
}

// ---- Tab order rule (WCAG 2.4.3 Focus Order) ----
// Hybrid strictness:
//  - Duplicate or non-numeric tabOrder values → Fail.
//  - Decorative shapes/images with tabOrder >= 0 (i.e. focusable) → Warn,
//    plus a "suggested decorative" hint to set them to -1.
//  - Hidden visuals are excluded from tab-order validation.
//  - Visuals with no tabOrder authored are not treated as failures; Power BI
//    can append them using its default order.
/**
 * Canonical filter for tab-order checks on a page.
 * Centralised so per-visual checks and the page-level summary always
 * operate on the same set of visuals.
 *
 * - `visible`     : visuals NOT explicitly hidden from tab order
 *                   (Selection pane → "-", i.e. `isHiddenFromTabOrder === true`).
 * - `authored`    : visible visuals that have an explicit `tabOrderIndex`.
 *                   These are the ones the author included in the Selection
 *                   pane's tab order. Visuals with `tabOrderIndex == null`
 *                   are excluded  -  Power BI will append them in default order,
 *                   but they are not part of the authored sequence and must
 *                   not influence reading-order comparisons.
 * - `unauthored`  : visible visuals with no explicit tab order.
 * - `hidden`      : visuals explicitly excluded from tab order.
 */
export interface TabOrderEligibility {
  visible: ParsedVisual[];
  authored: { v: ParsedVisual; t: number }[];
  unauthored: ParsedVisual[];
  hidden: ParsedVisual[];
}

export function getTabOrderEligibleVisuals(p: ParsedPage): TabOrderEligibility {
  const hidden = p.visuals.filter((v) => v.isHiddenFromTabOrder);
  const visible = p.visuals.filter((v) => !v.isHiddenFromTabOrder);
  const authored = visible
    .filter((v) => v.tabOrderIndex != null)
    .map((v) => ({ v, t: v.tabOrderIndex as number }));
  const unauthored = visible.filter((v) => v.tabOrderIndex == null);
  return { visible, authored, unauthored, hidden };
}

function visualHeight(v: ParsedVisual): number {
  const height = Number(v.height);
  if (Number.isFinite(height) && height > 0) return height;
  const legacyHeight = Number(v.h);
  return Number.isFinite(legacyHeight) && legacyHeight > 0 ? legacyHeight : 0;
}

function visualWidth(v: ParsedVisual): number {
  const width = Number(v.width);
  if (Number.isFinite(width) && width > 0) return width;
  const legacyWidth = Number(v.w);
  return Number.isFinite(legacyWidth) && legacyWidth > 0 ? legacyWidth : 0;
}

function visualArea(v: ParsedVisual): number {
  return visualWidth(v) * visualHeight(v);
}

function intersectArea(a: ParsedVisual, b: ParsedVisual): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + visualWidth(a), b.x + visualWidth(b));
  const y2 = Math.min(a.y + visualHeight(a), b.y + visualHeight(b));
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

// Groups the visuals sharing a sibling level: the page's top-level visuals
// (key null  -  a group container itself appears here, as the single stop it
// represents at this level), plus one entry per group id for that group's
// direct children. Because parentGroupId already points straight at the
// immediate parent (see resolveAbsolutePositions/pbixParser.ts), a simple
// group-by is enough to get every nesting level at once - a nested group's
// children are keyed by that nested group's own id, which is a different
// bucket from its parent's, with no separate recursion needed.
function siblingLevels<T>(items: T[], keyOf: (item: T) => string | null): Map<string | null, T[]> {
  const levels = new Map<string | null, T[]>();
  for (const item of items) {
    const key = keyOf(item) ?? null;
    const list = levels.get(key) ?? [];
    list.push(item);
    levels.set(key, list);
  }
  return levels;
}

// Only a real data visual, a slicer, or a button can be the "base" an
// overlaid visual sits on top of - a shape, image or text box never counts,
// so a full-bleed background rectangle can't swallow every other visual on
// the page into one giant "overlay group".
function canBeOverlayBase(v: ParsedVisual): boolean {
  return isDataVisual(v) || typeIs(v, "slicer", "button");
}

// A visual counts as an "overlay" of another when at least 90% of its own
// area sits inside that other visual's box. When a visual qualifies as an
// overlay of more than one eligible base, it's attached to the smallest one
// (the most specific container it sits on top of).
function computeOverlays(items: ParsedVisual[]): { overlaysByBase: Map<string, ParsedVisual[]>; overlayIds: Set<string> } {
  const overlaysByBase = new Map<string, ParsedVisual[]>();
  const overlayIds = new Set<string>();
  for (const v of items) {
    const vArea = visualArea(v);
    if (vArea <= 0) continue;
    let bestBase: ParsedVisual | null = null;
    let bestBaseArea = Number.POSITIVE_INFINITY;
    for (const base of items) {
      if (base.id === v.id || !canBeOverlayBase(base)) continue;
      const baseArea = visualArea(base);
      if (baseArea <= 0) continue;
      const overlapRatio = intersectArea(v, base) / vArea;
      if (overlapRatio >= 0.9 && baseArea < bestBaseArea) {
        bestBase = base;
        bestBaseArea = baseArea;
      }
    }
    if (bestBase) {
      overlayIds.add(v.id);
      const list = overlaysByBase.get(bestBase.id) ?? [];
      list.push(v);
      overlaysByBase.set(bestBase.id, list);
    }
  }
  // Multiple overlays on the same base: top-to-bottom, then left-to-right.
  for (const list of overlaysByBase.values()) {
    list.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  return { overlaysByBase, overlayIds };
}

// Groups non-overlay visuals into rows for the "expected" reading order.
// Walk top to bottom; each unassigned visual starts a new row as that row's
// anchor, and another visual joins ONLY if its vertical overlap with the
// anchor is at least 50% of the shorter of the two heights - comparison is
// always against the row's anchor, never chained transitively through
// other row members, so a tall visual can't drag in a short one two rows
// down via an intermediate.
function buildRows(items: ParsedVisual[]): ParsedVisual[][] {
  const remaining = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const used = new Set<string>();
  const rows: ParsedVisual[][] = [];
  for (const anchor of remaining) {
    if (used.has(anchor.id)) continue;
    const anchorHeight = visualHeight(anchor);
    const row = [anchor];
    used.add(anchor.id);
    for (const other of remaining) {
      if (used.has(other.id)) continue;
      const otherHeight = visualHeight(other);
      const shorter = Math.min(anchorHeight, otherHeight);
      if (shorter <= 0) continue;
      const overlap = Math.max(0, Math.min(anchor.y + anchorHeight, other.y + otherHeight) - Math.max(anchor.y, other.y));
      if (overlap / shorter >= 0.5) {
        row.push(other);
        used.add(other.id);
      }
    }
    row.sort((a, b) => a.x - b.x || a.y - b.y);
    rows.push(row);
  }
  // `remaining` is already y-ordered and each row's anchor is the first
  // unused visual encountered in that order, so rows are already in top-to-
  // bottom order by anchor - no re-sort needed.
  return rows;
}

// Builds the layout-inferred reading order for one sibling level: overlays
// removed from row-clustering, then re-inserted immediately after their base.
function buildExpectedOrder(items: ParsedVisual[]): ParsedVisual[] {
  const { overlaysByBase, overlayIds } = computeOverlays(items);
  const base = items.filter((v) => !overlayIds.has(v.id));
  const rows = buildRows(base);
  const ordered: ParsedVisual[] = [];
  for (const row of rows) {
    for (const v of row) {
      ordered.push(v);
      const overlays = overlaysByBase.get(v.id);
      if (overlays) ordered.push(...overlays);
    }
  }
  return ordered;
}

// The authored reading order for one sibling level. Sorts by tabOrderRank
// ASCENDING (1 = first) - NOT by tabOrderIndex/`.t`, and NOT descending.
//
// tabOrderIndex is ambiguous: normalisePowerBiLayoutTabOrder (pbixParser.ts)
// rewrites it into a 1..N rank (ascending, 1 = first) for pages whose raw
// values are all unique, non-negative multiples of 1000, but leaves it as
// the untouched raw value (descending, largest = first) otherwise - the same
// field means two different, opposite-direction things depending on which
// case applies, and nothing here can tell which one it's looking at from the
// number alone. tabOrderRank (see its doc comment on ParsedVisual, and
// assignTabOrderRanks in pbixParser.ts) exists specifically to remove that
// ambiguity: it's always "ascending, 1 = first", computed once per page from
// the pristine raw value before normalisePowerBiLayoutTabOrder runs - so the
// exact same comparison (ascending by tabOrderRank) is correct for both the
// small-plain-numbers case (e.g. 25/20/15/10/5/0) and the multiples-of-1000
// case (e.g. 2000/1000/0), with no special-casing for magnitude.
function buildAuthoredOrder(entries: { v: ParsedVisual; t: number }[]): ParsedVisual[] {
  return [...entries]
    .sort((a, b) => (a.v.tabOrderRank ?? Number.POSITIVE_INFINITY) - (b.v.tabOrderRank ?? Number.POSITIVE_INFINITY))
    .map((e) => e.v);
}

function sameVisualOrder(a: ParsedVisual[], b: ParsedVisual[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v.id === b[i]?.id);
}

const MAX_SUGGESTED_ORDER_ITEMS = 12;

function formatSuggestedOrder(order: ParsedVisual[]): string {
  const shown = order.slice(0, MAX_SUGGESTED_ORDER_ITEMS);
  const list = shown.map((v, i) => `${i + 1}. ${describeVisual(v)}`).join(", ");
  const remaining = order.length - shown.length;
  return remaining > 0 ? `${list}, and ${remaining} more` : list;
}

/** Per-sibling-level breakdown behind the "tab order may not follow the
 *  layout" finding below - exposed for a future `explain`/debug CLI command,
 *  not currently used elsewhere in this codebase. Superseded the old
 *  page-wide getTabOrderReadingOrderDebug/clusterTabOrderRows, which had no
 *  group scoping and sorted authored order ascending (the wrong direction -
 *  see buildAuthoredOrder above) and were both unused (grep-confirmed) - removed
 *  rather than kept, since this replaces them fully. */
export interface TabOrderLevelDebug {
  /** null = the page's top-level visuals; otherwise the id of the group
   *  container whose direct children this level covers. */
  groupId: string | null;
  groupLabel: string | null;
  // tabOrderRank is the field the ordering above is actually computed from
  // (ascending, 1 = first - see buildAuthoredOrder); tabOrderIndex is
  // included alongside only as the raw/normalised value a person might
  // recognise from the Selection pane or a JSON dump, and must NOT be used
  // to re-derive order (see its doc comment on ParsedVisual).
  authoredOrder: { id: string; label: string; tabOrderIndex: number; tabOrderRank: number }[];
  expectedOrder: { id: string; label: string; tabOrderIndex: number; tabOrderRank: number }[];
  overlays: { visualId: string; label: string; baseId: string }[];
  rows: string[][];
  matchesLayout: boolean;
}

export function getTabOrderLayoutDebug(p: ParsedPage): TabOrderLevelDebug[] {
  const { authored } = getTabOrderEligibleVisuals(p);
  const levels = siblingLevels(authored, (e) => e.v.parentGroupId ?? null);
  const out: TabOrderLevelDebug[] = [];
  for (const [groupId, entries] of levels) {
    if (entries.length < 2) continue;
    const items = entries.map((e) => e.v);
    const { overlaysByBase, overlayIds } = computeOverlays(items);
    const rows = buildRows(items.filter((v) => !overlayIds.has(v.id)));
    const authoredOrder = buildAuthoredOrder(entries);
    const expectedOrder = buildExpectedOrder(items);
    const groupVisual = groupId ? p.visuals.find((v) => v.id === groupId) ?? null : null;
    const overlays: TabOrderLevelDebug["overlays"] = [];
    for (const [baseId, list] of overlaysByBase) {
      for (const ov of list) overlays.push({ visualId: ov.id, label: describeVisual(ov), baseId });
    }
    out.push({
      groupId,
      groupLabel: groupVisual ? describeVisual(groupVisual) : null,
      authoredOrder: authoredOrder.map((v) => ({ id: v.id, label: describeVisual(v), tabOrderIndex: v.tabOrderIndex as number, tabOrderRank: v.tabOrderRank as number })),
      expectedOrder: expectedOrder.map((v) => ({ id: v.id, label: describeVisual(v), tabOrderIndex: v.tabOrderIndex as number, tabOrderRank: v.tabOrderRank as number })),
      overlays,
      rows: rows.map((row) => row.map((v) => v.id)),
      matchesLayout: sameVisualOrder(authoredOrder, expectedOrder),
    });
  }
  return out;
}

// New finding (advisory only, see below): for each sibling level with at
// least two authored visuals, compare the authored tab sequence against the
// layout-inferred one and flag the first point where they diverge.
function tabOrderLayoutMismatchIssues(p: ParsedPage): Issue[] {
  const { authored } = getTabOrderEligibleVisuals(p);
  const levels = siblingLevels(authored, (e) => e.v.parentGroupId ?? null);
  const issues: Issue[] = [];

  for (const [groupId, entries] of levels) {
    // Nothing to compare with fewer than two authored visuals at this level.
    if (entries.length < 2) continue;

    const authoredOrder = buildAuthoredOrder(entries);
    const expectedOrder = buildExpectedOrder(entries.map((e) => e.v));
    if (sameVisualOrder(authoredOrder, expectedOrder)) continue;

    // authoredOrder and expectedOrder are always permutations of the exact
    // same visual set (both built from `entries`), so findIndex is
    // guaranteed to find a differing position here - sameVisualOrder just
    // returned false, and equal-length permutations that aren't identical
    // must differ somewhere.
    const mismatchIndex = authoredOrder.findIndex((v, i) => expectedOrder[i]?.id !== v.id);
    const authoredVisual = authoredOrder[mismatchIndex];
    const expectedVisual = expectedOrder[mismatchIndex];
    const groupVisual = groupId ? p.visuals.find((v) => v.id === groupId) ?? null : null;
    const levelSuffix = groupVisual ? ` inside group "${groupVisual.groupDisplayName?.trim() || "unnamed"}"` : "";

    issues.push({
      id: `${p.id}-tab-layout-mismatch${groupVisual ? `-${groupVisual.id}` : ""}`,
      category: "tabOrder",
      severity: "warn",
      title: `Tab order may not follow the layout${levelSuffix}`,
      detail: `Position ${mismatchIndex + 1} is "${describeVisual(authoredVisual)}" but the layout suggests "${describeVisual(expectedVisual)}".`,
      why: "WCAG 2.4.3 (Focus Order) expects the tab sequence to follow a meaningful reading order. This expected order is inferred from visual position only  -  only the report's author truly knows the intended reading order, so treat this as advisory, not a hard rule.",
      fix: `In Power BI Desktop: View → Selection Pane → Tab Order. Suggested order: ${formatSuggestedOrder(expectedOrder)}.`,
      pageId: p.id,
      visualId: groupVisual ? groupVisual.id : undefined,
    });
  }

  return issues;
}

function tabOrderRulesForPage(p: ParsedPage): Issue[] {
  const issues: Issue[] = [];
  const { authored } = getTabOrderEligibleVisuals(p);
  const decorative = p.visuals.filter((v) => v.isDecorative);

  // 1. Decorative-but-focusable suggestions. Skip when author already set -1.
  //    Per-visual, not scoped by sibling level  -  a group itself is never
  //    decorative, so this never needs to reason about nesting.
  for (const v of decorative) {
    if (!v.isHiddenFromTabOrder && v.tabOrderIndex != null) {
      issues.push({
        id: `${v.id}-tab-decorative-focusable`,
        category: "tabOrder",
        severity: "warn",
        title: "Decorative element receives keyboard focus",
        detail: `${describeVisual(v)} appears decorative but has tab order ${v.tabOrderIndex}. Keyboard users will land on it with nothing to read.`,
        why: "WCAG 2.4.3  -  focus order must be meaningful. Decorative shapes shouldn't receive focus.",
        fix: "In Power BI Desktop: View → Selection Pane → Tab Order → set this element's tab order to '-' (hidden) so it's skipped.",
        pageId: p.id,
        visualId: v.id,
      });
    }
  }

  // 2. Duplicate tab order values, scoped to siblings at the same nesting
  //    level. A value shared between a top-level visual and a visual inside
  //    a group (or between two different groups) is not a real duplicate to
  //    a keyboard user - they're never in the same tab-order sequence, since
  //    Power BI resolves each group's internal tab order independently of
  //    the page's top-level sequence.
  const levels = siblingLevels(authored, (e) => e.v.parentGroupId ?? null);
  for (const [groupId, levelEntries] of levels) {
    const byVal = new Map<number, typeof authored>();
    for (const e of levelEntries) {
      if (!byVal.has(e.t)) byVal.set(e.t, []);
      byVal.get(e.t)!.push(e);
    }
    for (const [t, group] of byVal) {
      if (group.length > 1) {
        issues.push({
          id: `${p.id}-tab-duplicate-${t}${groupId ? `-${groupId}` : ""}`,
          category: "tabOrder",
          severity: "fail",
          title: `Duplicate tab order value (${t})`,
          detail: `${group.length} elements share tab order ${t}: ${group.map((g) => describeVisual(g.v)).join("; ")}.`,
          why: "Duplicate focus indices make keyboard navigation unpredictable  -  screen-reader users may skip or revisit the same content.",
          fix: "View → Selection Pane → Tab Order. Give each focusable element a unique position in the sequence.",
          pageId: p.id,
        });
      }
    }
  }

  // 3. Tab order vs. inferred layout reading order (new, warn-only  -  see
  //    tabOrderLayoutMismatchIssues doc comment).
  issues.push(...tabOrderLayoutMismatchIssues(p));

  return issues;
}

// ---- Target size rule (WCAG 2.5.8, interpreted via UI measurement) ----
// Evaluates interactive elements (buttons, slicers, page/bookmark navigators,
// icon-only shapes acting as controls) against:
//   - WCAG 2.5.8 minimum (24×24 CSS px)
//   - PBIX A11y recommended usability standard (40×40 px)
// Power BI canvases are authored at 1280×720 by default; when the canvas
// differs we apply proportional scaling (canvasHeight / 720) so thresholds
// match the rendered size at the authored canvas  -  mirroring the standalone
// UI Layout Calculator.
const BASE_CANVAS_HEIGHT = 720;
const WCAG_MIN_PX = 24;
const UX_REC_PX = 40;
const ICON_REC_PX = 60;

function isInteractiveVisual(v: ParsedVisual): boolean {
  const t = (v.type ?? "").toLowerCase().trim();
  if (!t) return false;
  if (typeIs(v, "button", "navigator", "slicer")) return true;
  // Shape/image visuals that are NOT decorative and have no text label are
  // treated as icon-only controls (a common Power BI pattern).
  if (typeIs(v, "shape", "image") && !v.isDecorative && !v.hasText) return true;
  return false;
}

function targetSizeRule(v: ParsedVisual, canvasH: number): Issue | null {
  if (!isInteractiveVisual(v)) return null;
  const w = Number(v.w) || 0;
  const h = Number(v.h) || 0;
  if (w <= 0 || h <= 0) return null;

  const t = (v.type ?? "").toLowerCase().trim();
  const isIconOnly = (t.includes("shape") || t.includes("image")) && !v.hasText;
  const isSlicer = t.includes("slicer");

  const scale = canvasH > 0 ? canvasH / BASE_CANVAS_HEIGHT : 1;
  const minThreshold = WCAG_MIN_PX * scale;
  // Icons get a larger recommended target (60×60 base); buttons/slicers/navigators keep 40×40.
  const recBase = isIconOnly ? ICON_REC_PX : UX_REC_PX;
  const uxThreshold = recBase * scale;
  const minDim = Math.min(w, h);
  if (minDim >= uxThreshold) return null;

  const failsWcag = minDim < minThreshold;
  const severity: Severity = failsWcag ? "fail" : "warn";
  const recLabel = `${recBase}×${recBase} px`;
  const wcagNote = failsWcag
    ? `Below WCAG 2.5.8 minimum (24×24 px, interpreted via UI measurement) and below the recommended ${recLabel}.`
    : `Meets WCAG 2.5.8 minimum (24×24 px, interpreted via UI measurement) but below the recommended ${recLabel}.`;
  const slicerNote = isSlicer
    ? " For slicers we measure the container; individual selectable items may be smaller and should also be checked."
    : "";
  const iconNote = isIconOnly
    ? " Icon-only controls without a visible label carry a higher misclick risk, so the PBIX A11y standard recommends 60×60 px."
    : "";

  const wDisp = Math.round(w);
  const hDisp = Math.round(h);
  const minRound = Math.round(minThreshold);
  const uxRound = Math.round(uxThreshold);

  return {
    id: `${v.id}-target-size`,
    category: "targetSize",
    severity,
    title: failsWcag
      ? `Interactive target below 24×24 px (${wDisp}×${hDisp})`
      : `Interactive target below recommended ${recLabel} (${wDisp}×${hDisp})`,
    detail: `${describeVisual(v)} measures ${wDisp}×${hDisp} px on a ${Math.round(canvasH)}px-tall canvas (scaled thresholds: ${minRound}px minimum, ${uxRound}px recommended).${slicerNote}${iconNote}`,
    why: `${wcagNote} Larger targets reduce misclicks for pointer, touch and assistive input users.`,
    fix: `Resize the element so both width and height are at least ${uxRound}px (${recLabel} at base 1280×720). In Power BI: select the visual → Format pane → General → Size, or drag the corner handles.`,
    visualId: v.id,
  };
}


// ---- Top-level analyze ----

export function analyze(report: ParsedReport, selection: CheckSelection = ALL_CHECKS): AnalysisResult {
  const requiredMinPt = minFontPt(report.canvasWidth, report.canvasHeight);
  const pages: PageReport[] = report.pages.map((p) => {
    const visualReports: VisualReport[] = p.visuals.map((v) => {
      const issues: Issue[] = [];
      if (selection.altText) {
        const alt = altTextRule(v);
        if (alt) issues.push(alt);
      }
      if (selection.visualTitles) {
        const title = visualTitleRule(v);
        if (title) issues.push(title);
        const groupName = visualGroupNameRule(v);
        if (groupName) issues.push(groupName);
      }
      if (selection.axisTitles) {
        issues.push(...axisTitleRule(v));
      }
      // Use the page's own canvas size when available  -  Power BI canvas
      // dimensions are per-page and drive the scaled thresholds (matches the
      // UI Layout Calculator behaviour).
      const effectiveW = Number(p.width) > 0 ? Number(p.width) : report.canvasWidth;
      const effectiveH = Number(p.height) > 0 ? Number(p.height) : report.canvasHeight;
      if (selection.fontScaling) {
        const font = fontSizeRule(v, effectiveW, effectiveH);
        if (font) issues.push(font);
      }
      const checks = selection.contrast ? contrastChecksFor(v) : [];
      if (selection.contrast) {
        issues.push(...contrastIssues(v, checks));
        issues.push(...nonTextContrastIssues(v));
      }
      if (selection.targetSize) {
        const ts = targetSizeRule(v, effectiveH);
        if (ts) issues.push(ts);
      }
      // Colour-blindness check is disabled  -  see Simulator note in UI.
      // if (selection.colourblind) issues.push(...colourblindIssues(v));
      return { visual: v, issues, contrastChecks: checks };
    });

    const pageIssues: Issue[] = [];
    if (selection.pageTitles) {
      const pt = pageTitleRule(p);
      if (pt) pageIssues.push(pt);
    }
    if (selection.tabOrder) {
      pageIssues.push(...tabOrderRulesForPage(p));
    }

    // Clutter should reflect *data visualisations* only  -  exclude shapes,
    // text/page-title boxes, images, navigation buttons, slicers and visual
    // groups (see isDataVisual above), which contribute decoration, controls
    // or pure layout scaffolding rather than information density. We match
    // by substring on the lowercased type so we also catch variants like
    // "advancedSlicerVisual", "imageVisual", "basicShape", custom visuals
    // whose id contains "slicer", etc.
    const dataVisuals = p.visuals.filter(isDataVisual);
    const clutter = clutterIndex(
      p.width,
      p.height,
      dataVisuals.map((v) => ({ id: v.id, type: v.type, x: v.x, y: v.y, w: v.w, h: v.h }))
    );
    const groupedNote = clutter.groupedCardCount > 0
      ? ` (grouped ${clutter.groupedCardCount + 1} adjacent card visuals into ${clutter.groupedCardCount > 0 ? "KPI strips" : "a strip"})`
      : "";
    // Clutter is the hardest signal to judge automatically  -  designers often
    // have good reasons for dense layouts. We therefore *never* raise it as a
    // failure: it is always surfaced as a warning (or stays silent on Low) and
    // the density percentage is included so the user can decide.
    const densityPct = Math.round(clutter.density * 100);
    if (selection.clutter && clutter.score === "High") {
      pageIssues.push({
        id: `${p.id}-clutter`,
        category: "clutter",
        severity: "warn",
        title: `Page may be cluttered (density ${densityPct}%)`,
        detail: `${clutter.visualCount} data visuals, density ${densityPct}%, ${clutter.overlaps.length} overlaps${groupedNote}. This is guidance, not an error  -  you may have a deliberate reason for a dense layout.`,
        why: "Dense, overlapping pages can overwhelm working memory and make screen-reader navigation harder, but this is judgement-based.",
        fix: "Consider splitting the page, adding whitespace, or moving secondary visuals to a tooltip / drill-through page.",
        pageId: p.id,
      });
    } else if (selection.clutter && clutter.score === "Medium") {
      pageIssues.push({
        id: `${p.id}-clutter-medium`,
        category: "clutter",
        severity: "warn",
        title: `Moderate page density (${densityPct}%)`,
        detail: `${clutter.visualCount} data visuals, density ${densityPct}%${groupedNote}. Guidance only  -  review whether the layout still feels comfortable.`,
        why: "Approaching the comfortable density limit for a single page.",
        fix: "Consider whether any visuals could move to drill-through or tooltip pages.",
        pageId: p.id,
      });
    }

    return { page: p, issues: pageIssues, visuals: visualReports, clutter };
  });

  // Summary
  const byCategory: AnalysisResult["summary"]["byCategory"] = {
    contrast: { fail: 0, warn: 0, pass: 0 },
    colourblind: { fail: 0, warn: 0, pass: 0 },
    altText: { fail: 0, warn: 0, pass: 0 },
    clutter: { fail: 0, warn: 0, pass: 0 },
    pageTitles: { fail: 0, warn: 0, pass: 0 },
    visualTitles: { fail: 0, warn: 0, pass: 0 },
    axisTitles: { fail: 0, warn: 0, pass: 0 },
    fontScaling: { fail: 0, warn: 0, pass: 0 },
    tabOrder: { fail: 0, warn: 0, pass: 0 },
    targetSize: { fail: 0, warn: 0, pass: 0 },
    other: { fail: 0, warn: 0, pass: 0 },
  };

  let totalIssues = 0;
  let totalFails = 0;
  let totalWarns = 0;
  let visualCount = 0;
  for (const p of pages) {
    for (const i of p.issues) {
      if (i.severity === "fail") byCategory[i.category].fail++;
      else if (i.severity === "warn") byCategory[i.category].warn++;
      totalIssues++;
      if (i.severity === "fail") totalFails++;
      if (i.severity === "warn") totalWarns++;
    }
    for (const v of p.visuals) {
      visualCount++;
      for (const i of v.issues) {
        if (i.severity === "fail") byCategory[i.category].fail++;
        else if (i.severity === "warn") byCategory[i.category].warn++;
        totalIssues++;
        if (i.severity === "fail") totalFails++;
        if (i.severity === "warn") totalWarns++;
      }
    }
  }

  // Score: 100 minus weighted issues per visual.
  const denom = Math.max(1, visualCount);
  const penalty = (totalFails * 5 + totalWarns * 2) / denom;
  const overallScore = Math.max(0, Math.min(100, Math.round(100 - penalty * 6)));

  return {
    fileName: report.fileName,
    fileSize: report.fileSize,
    canvasWidth: report.canvasWidth,
    canvasHeight: report.canvasHeight,
    requiredMinPt,
    runCvdSimulator: !!selection.colourblind,
    runCustomVisualsCheck: !!selection.customVisuals,
    pages,
    summary: {
      pageCount: pages.length,
      visualCount,
      issueCount: totalIssues,
      byCategory,
      overallScore,
    },
  };
}
