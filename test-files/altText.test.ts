import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFixture, visualIssuesByCategory } from "./testHelpers";

async function altTextIssuesById() {
  return visualIssuesByCategory(await analyzeFixture(), "altText");
}

test("a visual group with no alt text is flagged for missing alt text", async () => {
  const issues = await altTextIssuesById();
  const groupIssues = issues.get("groupA") ?? [];
  assert.equal(groupIssues.length, 1);
  assert.equal(groupIssues[0].id, "groupA-alt-missing");
  assert.equal(groupIssues[0].severity, "fail");
});

test("a group's missing-alt-text fix message asks for an item count with no literal number and no measure suggestion", async () => {
  const issues = await altTextIssuesById();
  const issue = (issues.get("groupA") ?? [])[0];
  assert.ok(issue, "expected a missing-alt-text issue for groupA");
  assert.match(issue.fix, /how many items/i);
  assert.doesNotMatch(issue.fix, /\d/);
  assert.doesNotMatch(issue.fix, /measure/i);
});

test("a group left with a placeholder alt text value is flagged as placeholder", async () => {
  const issues = await altTextIssuesById();
  const groupIssues = issues.get("groupDefaultName") ?? [];
  assert.equal(groupIssues.length, 1);
  assert.equal(groupIssues[0].id, "groupDefaultName-alt-placeholder");
  assert.equal(groupIssues[0].severity, "fail");
});

test("a group with real, descriptive alt text is not flagged", async () => {
  const issues = await altTextIssuesById();
  assert.deepEqual(issues.get("groupGoodAlt"), []);
});

test("an element inside a group with no alt text of its own is still flagged", async () => {
  const issues = await altTextIssuesById();
  const found = issues.get("visInGroupMissingAlt") ?? [];
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "visInGroupMissingAlt-alt-missing");
  assert.equal(found[0].severity, "fail");
});

test("a real visual with alt text set is not flagged", async () => {
  const issues = await altTextIssuesById();
  assert.deepEqual(issues.get("visGoodAlt"), []);
});

test("a real visual missing alt text is still flagged", async () => {
  const issues = await altTextIssuesById();
  const visualIssues = issues.get("visMissingAlt") ?? [];
  assert.equal(visualIssues.length, 1);
  assert.equal(visualIssues[0].id, "visMissingAlt-alt-missing");
  assert.equal(visualIssues[0].severity, "fail");
});
