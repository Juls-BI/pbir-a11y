import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFixture, visualIssuesByCategory } from "./testHelpers";
import { loadPbirFromFolder } from "../src/io/loadFromFolder";
import { analyze, ALL_CHECKS } from "../src/lib/rulesEngine";

async function visualTitleIssuesById() {
  return visualIssuesByCategory(await analyzeFixture(), "visualTitles");
}

test("a visual group with a real author-given name is not flagged", async () => {
  const issues = await visualTitleIssuesById();
  assert.deepEqual(issues.get("groupA"), []);
});

test("a visual group left with Power BI's default name is flagged, advisory-only", async () => {
  const issues = await visualTitleIssuesById();
  const groupIssues = issues.get("groupDefaultName") ?? [];
  assert.equal(groupIssues.length, 1);
  assert.equal(groupIssues[0].id, "groupDefaultName-group-name-default");
  assert.equal(groupIssues[0].severity, "info");
});

test("an info-severity group-naming issue does not change summary.overallScore", async () => {
  const fixtureDir = path.join(__dirname, "thin-report", "ThinReport.Report");
  const { report } = await loadPbirFromFolder(fixtureDir);
  const withDefaultName = analyze(report, ALL_CHECKS);

  // Same report, but with the one thing that trips the group-naming rule
  // fixed - if the issue were still scored, fixing it would raise the score.
  const patched = structuredClone(report);
  for (const page of patched.pages) {
    for (const v of page.visuals) {
      if (v.id === "groupDefaultName") v.groupDisplayName = "Regional KPIs";
    }
  }
  const withRealName = analyze(patched, ALL_CHECKS);

  // Compare the fail/warn counts directly rather than only the rounded
  // overallScore - a single issue's score contribution can round away to
  // nothing on a fixture this size, which would let this test pass even if
  // the issue were still wrongly scored.
  assert.deepEqual(withDefaultName.summary.byCategory.visualTitles, withRealName.summary.byCategory.visualTitles);
  assert.equal(withDefaultName.summary.overallScore, withRealName.summary.overallScore);
});
