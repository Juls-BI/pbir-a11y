import path from "node:path";
import { loadPbirFromFolder } from "../src/io/loadFromFolder";
import { analyze, ALL_CHECKS, type AnalysisResult, type Issue } from "../src/lib/rulesEngine";
import { assignTabOrderRanks, type ParsedVisual, type ParsedPage, type ParsedReport } from "../src/lib/pbixParser";

const DEFAULT_FIXTURE = path.join(__dirname, "thin-report", "ThinReport.Report");

// ---- In-memory fixture builders ----
// For rule-logic tests that don't need a real PBIP/PBIR project on disk -
// clutter, tab order, and anything else that's a pure function of already-
// parsed ParsedVisual/ParsedPage/ParsedReport data. Every ParsedVisual field
// gets a sensible default so a test only has to specify what it cares about.
// `width`/`height` and the legacy `w`/`h` aliases are kept in sync, matching
// how extractVisual (pbixParser.ts) always sets both to the same value.

export function makeVisual(o: {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tabOrderIndex?: number | null;
  isHiddenFromTabOrder?: boolean;
  isDecorative?: boolean;
  parentGroupId?: string | null;
  groupDisplayName?: string | null;
  titleText?: string | null;
  fields?: string[];
}): ParsedVisual {
  const width = o.width ?? 100;
  const height = o.height ?? 100;
  return {
    visualId: o.id,
    id: o.id,
    name: o.id,
    displayName: o.titleText ?? o.id,
    type: o.type,
    x: o.x ?? 0,
    y: o.y ?? 0,
    width,
    height,
    w: width,
    h: height,
    z: 0,
    altText: null,
    titleVisible: true,
    titleText: o.titleText ?? null,
    titleFontPt: null,
    titleColor: null,
    labelFontPt: null,
    labelColor: null,
    categoryColor: null,
    axisColor: null,
    background: null,
    hasAxes: false,
    xAxisTitleVisible: null,
    yAxisTitleVisible: null,
    fontSizes: [],
    textColors: [],
    fillColors: [],
    hasText: false,
    fields: o.fields ?? [],
    tabOrder: o.isHiddenFromTabOrder ? -1 : (o.tabOrderIndex ?? null),
    tabOrderIndex: o.isHiddenFromTabOrder ? null : (o.tabOrderIndex ?? null),
    isHiddenFromTabOrder: o.isHiddenFromTabOrder ?? false,
    isDecorative: o.isDecorative ?? false,
    groupDisplayName: o.groupDisplayName ?? null,
    parentGroupId: o.parentGroupId ?? null,
    // Left null here (like extractVisual does) - makePage below runs every
    // page's visuals through assignTabOrderRanks, the same whole-page pass
    // extractPage uses, so a test only has to set tabOrderIndex and gets a
    // realistic tabOrderRank for free.
    tabOrderRank: null,
  };
}

export function makePage(id: string, visuals: ParsedVisual[], o?: { width?: number; height?: number }): ParsedPage {
  return {
    id,
    name: id,
    displayName: id,
    width: o?.width ?? 1280,
    height: o?.height ?? 720,
    hidden: false,
    pageTitleVisible: true,
    // Mirrors extractPage (pbixParser.ts): tabOrderRank is derived once per
    // page from the raw tabOrderIndex values, so tests that only set
    // tabOrderIndex get realistic, order-correct ranks automatically.
    visuals: assignTabOrderRanks(visuals),
  };
}

export function makeReport(pages: ParsedPage[]): ParsedReport {
  return {
    fileName: "in-memory.pbir",
    fileSize: 0,
    canvasWidth: 1280,
    canvasHeight: 720,
    themeColors: [],
    pages,
  };
}

export function analyzeReport(pages: ParsedPage[]): AnalysisResult {
  return analyze(makeReport(pages), ALL_CHECKS);
}

export async function analyzeFixture(fixtureDir: string = DEFAULT_FIXTURE): Promise<AnalysisResult> {
  const { report } = await loadPbirFromFolder(fixtureDir);
  return analyze(report, ALL_CHECKS);
}

export function visualIssuesByCategory(result: AnalysisResult, category: Issue["category"]): Map<string, Issue[]> {
  const byId = new Map<string, Issue[]>();
  for (const page of result.pages) {
    for (const visual of page.visuals) {
      byId.set(visual.visual.id, visual.issues.filter((i) => i.category === category));
    }
  }
  return byId;
}

export function pageIssuesByCategory(result: AnalysisResult, category: Issue["category"]): Map<string, Issue[]> {
  const byId = new Map<string, Issue[]>();
  for (const page of result.pages) {
    byId.set(page.page.id, page.issues.filter((i) => i.category === category));
  }
  return byId;
}

// tabOrder issues are page-level (not attached to VisualReport.issues), but
// carry the originating visual's id in `visualId` — see tabOrderRulesForPage
// in rulesEngine.ts.
export function pageIssuesByVisualId(result: AnalysisResult, category: Issue["category"]): Map<string, Issue[]> {
  const byId = new Map<string, Issue[]>();
  for (const page of result.pages) {
    for (const issue of page.issues) {
      if (issue.category !== category || !issue.visualId) continue;
      const existing = byId.get(issue.visualId) ?? [];
      existing.push(issue);
      byId.set(issue.visualId, existing);
    }
  }
  return byId;
}
