import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFixture, visualIssuesByCategory, pageIssuesByCategory } from "./testHelpers";
import type { Issue } from "../src/lib/rulesEngine";

async function visualIssuesById(category: Issue["category"]) {
  return visualIssuesByCategory(await analyzeFixture(), category);
}

async function pageIssuesById(category: Issue["category"]) {
  return pageIssuesByCategory(await analyzeFixture(), category);
}

test("an interactive control below the WCAG 2.5.8 minimum is flagged for targetSize", async () => {
  const issues = await visualIssuesById("targetSize");
  const found = issues.get("buttonSmall") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "buttonSmall-target-size");
  assert.equal(found[0].severity, "fail");
});

test("an interactive control at or above the recommended size is not flagged for targetSize", async () => {
  const issues = await visualIssuesById("targetSize");
  assert.deepEqual(issues.get("buttonGood"), []);
});

test("a page with many overlapping data visuals is flagged for clutter", async () => {
  const issues = await pageIssuesById("clutter");
  const found = issues.get("Page5") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "Page5-clutter");
  assert.equal(found[0].severity, "warn");
});

test("a page with a low-density, non-overlapping layout is not flagged for clutter", async () => {
  const issues = await pageIssuesById("clutter");
  assert.deepEqual(issues.get("Page1"), []);
});
