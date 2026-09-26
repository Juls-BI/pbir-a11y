import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFixture, visualIssuesByCategory } from "./testHelpers";
import type { Issue } from "../src/lib/rulesEngine";

async function issuesById(category: Issue["category"]) {
  return visualIssuesByCategory(await analyzeFixture(), category);
}

test("a chart with its title turned off is flagged for visualTitles", async () => {
  const issues = await issuesById("visualTitles");
  const found = issues.get("barTitleOff") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "barTitleOff-title-off");
  assert.equal(found[0].severity, "warn");
});

test("a slicer with no authored title text is flagged for visualTitles", async () => {
  const issues = await issuesById("visualTitles");
  const found = issues.get("slicerNoTitle") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "slicerNoTitle-title-missing");
});

test("a chart with its title shown and text set is not flagged for visualTitles", async () => {
  const issues = await issuesById("visualTitles");
  assert.deepEqual(issues.get("barAxesOn"), []);
});

test("a chart with both axis titles turned off is flagged for axisTitles on each axis", async () => {
  const issues = await issuesById("axisTitles");
  const found = issues.get("barAxesOff") ?? [];
  const ids = found.map((i) => i.id).sort();
  assert.deepEqual(ids, ["barAxesOff-x-axis-title-off", "barAxesOff-y-axis-title-off"]);
});

test("a chart with both axis titles turned on is not flagged for axisTitles", async () => {
  const issues = await issuesById("axisTitles");
  assert.deepEqual(issues.get("barAxesOn"), []);
});
