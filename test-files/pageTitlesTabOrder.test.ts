import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFixture, pageIssuesByCategory, pageIssuesByVisualId } from "./testHelpers";
import type { Issue } from "../src/lib/rulesEngine";

async function pageIssuesById(category: Issue["category"]) {
  return pageIssuesByCategory(await analyzeFixture(), category);
}

async function issuesByVisualId(category: Issue["category"]) {
  return pageIssuesByVisualId(await analyzeFixture(), category);
}

test("a page with no textbox/card near the top is flagged for pageTitles", async () => {
  const issues = await pageIssuesById("pageTitles");
  const found = issues.get("Page1") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "Page1-page-title-missing");
});

test("a page with a textbox near the top is not flagged for pageTitles", async () => {
  const issues = await pageIssuesById("pageTitles");
  assert.deepEqual(issues.get("Page3"), []);
});

test("two visuals sharing the same authored tab order are flagged for tabOrder", async () => {
  const issues = await pageIssuesById("tabOrder");
  const found = (issues.get("Page4") ?? []).filter((i) => i.id.includes("duplicate"));
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "Page4-tab-duplicate-5");
  assert.equal(found[0].severity, "fail");
});

test("a decorative shape with a non-hidden tab order is flagged for tabOrder", async () => {
  const issues = await issuesByVisualId("tabOrder");
  const found = issues.get("decorativeShape") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "decorativeShape-tab-decorative-focusable");
  assert.equal(found[0].severity, "warn");
});

test("a decorative shape nested inside a group is still flagged for a non-hidden tab order", async () => {
  const issues = await issuesByVisualId("tabOrder");
  const found = issues.get("decorativeShapeInGroup") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "decorativeShapeInGroup-tab-decorative-focusable");
  assert.equal(found[0].severity, "warn");
});

test("a page with unique tab orders and no focusable decorative shapes has no duplicate or decorative-focusable findings", async () => {
  // Page1's authored tab order values (visGoodAlt=1, visMissingAlt=2,
  // visInGroupMissingAlt=3) are all unique and there's no focusable
  // decorative shape here, so neither of those two checks should fire. This
  // no longer asserts a wholly empty array: Page1's groupA has its two
  // children's authored order (visInGroupMissingAlt first, since a HIGHER
  // tabOrderIndex is earlier - see buildAuthoredOrder in rulesEngine.ts)
  // running opposite to their top-to-bottom layout order (visGoodAlt sits
  // above visInGroupMissingAlt once absolute position is resolved), which
  // correctly trips the new tabOrder/layout-mismatch warning added alongside
  // group-aware tab order scoping - see tabOrderLayoutMismatchIssues.
  const issues = await pageIssuesById("tabOrder");
  const found = issues.get("Page1") ?? [];
  assert.deepEqual(found.filter((i) => i.id.includes("duplicate") || i.id.includes("decorative-focusable")), []);
});

test("Page1's group-scoped tab order does not match its layout, and is flagged as a per-group, advisory-only finding", async () => {
  const issues = await pageIssuesById("tabOrder");
  const found = (issues.get("Page1") ?? []).filter((i) => i.id.startsWith("Page1-tab-layout-mismatch"));
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "Page1-tab-layout-mismatch-groupA");
  assert.equal(found[0].severity, "warn");
  assert.equal(found[0].visualId, "groupA");
  assert.match(found[0].title, /inside group "KPI Group"/);
});

// Page8 is a real PBIR fixture (not in-memory) proving the full chain end to
// end: pbirParser reads each visual.json's `parentGroupName`, pbixParser's
// extractPage resolves it to `parentGroupId` and then to a page-absolute x/y
// via resolveAbsolutePositions, assignTabOrderRanks computes tabOrderRank
// from the pristine raw values, and normalisePowerBiLayoutTabOrder
// separately renumbers tabOrder/tabOrderIndex (unrelated to tabOrderRank) -
// all before tabOrderRulesForPage ever runs. Raw tabOrder values: groupB=4000,
// topSibling=3000, childA=1000, childB=2000, giving tabOrderRank groupB=1,
// topSibling=2, childB=3, childA=4 (rank 1 = largest raw value = first). See
// its visual.json files for the raw layout.
test("Page8: a group's internal tab order vs. layout mismatch is detected without disturbing the top-level sequence it sits in", async () => {
  const issues = await pageIssuesById("tabOrder");
  const found = issues.get("Page8") ?? [];
  const mismatches = found.filter((i) => i.id.startsWith("Page8-tab-layout-mismatch"));

  // Top level (groupB, topSibling) is authored in the same order its layout
  // suggests (groupB on the left, topSibling on the right), so only the
  // group-internal level should be flagged - not a plain "Page8-tab-layout-
  // mismatch" with no group suffix.
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].id, "Page8-tab-layout-mismatch-groupB");
  assert.equal(mismatches[0].severity, "warn");
  assert.equal(mismatches[0].visualId, "groupB");
  assert.match(mismatches[0].title, /inside group "Grouped KPIs"/);
});
