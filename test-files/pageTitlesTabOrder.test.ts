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

test("a page with unique tab orders and no focusable decorative shapes is not flagged for tabOrder", async () => {
  const issues = await pageIssuesById("tabOrder");
  assert.deepEqual(issues.get("Page1"), []);
});
