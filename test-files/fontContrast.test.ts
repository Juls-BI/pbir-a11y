import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFixture, visualIssuesByCategory } from "./testHelpers";
import type { Issue } from "../src/lib/rulesEngine";

async function issuesById(category: Issue["category"]) {
  return visualIssuesByCategory(await analyzeFixture(), category);
}

test("a visual with a font below the page's minimum is flagged for fontScaling", async () => {
  const issues = await issuesById("fontScaling");
  const found = issues.get("barSmallFont") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "barSmallFont-font-small");
  assert.equal(found[0].severity, "warn");
});

test("a visual with fonts at or above the page's minimum is not flagged for fontScaling", async () => {
  const issues = await issuesById("fontScaling");
  assert.deepEqual(issues.get("barGoodFont"), []);
});

test("a visual with a title color failing WCAG AA contrast is flagged for contrast", async () => {
  const issues = await issuesById("contrast");
  const found = issues.get("barLowContrast") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "barLowContrast-contrast-Title");
  assert.equal(found[0].severity, "fail");
});

test("a visual with a passing title/background color pair is not flagged for contrast", async () => {
  const issues = await issuesById("contrast");
  assert.deepEqual(issues.get("barGoodContrast"), []);
});
