import path from "node:path";
import { loadPbirFromFolder } from "../src/io/loadFromFolder";
import { analyze, ALL_CHECKS, type AnalysisResult, type Issue } from "../src/lib/rulesEngine";

const DEFAULT_FIXTURE = path.join(__dirname, "thin-report", "ThinReport.Report");

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
