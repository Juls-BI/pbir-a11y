// Tests for the new "tab order may not follow the layout" finding and for
// sibling-level (group-aware) scoping of the duplicate-tab-order check. These
// are pure functions of already-parsed data, so - like clutterIndex - they're
// exercised directly against in-memory ParsedVisual/ParsedPage objects
// (see makeVisual/makePage/analyzeReport in testHelpers.ts) rather than a
// full PBIR project on disk. A real-PBIR-project version of the grouped
// scenario (proving pbirParser's parentGroupName -> parentGroupId wiring and
// resolveAbsolutePositions end to end) lives in pageTitlesTabOrder.test.ts
// against the Page8 fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeVisual, makePage, analyzeReport } from "./testHelpers";

function tabOrderIssues(pageId: string, result: ReturnType<typeof analyzeReport>) {
  const page = result.pages.find((p) => p.page.id === pageId);
  return (page?.issues ?? []).filter((i) => i.category === "tabOrder");
}

test("a flat page whose authored order (real Six Sigma report numbers) contradicts its layout is flagged, naming the first mismatch", () => {
  // Raw values mirror a real customer PBIP page: Info Button=25, Page
  // Title=20, Card=15, Control Chart=10, Upper Text=5, Lower Box=0 - a HIGHER
  // raw tabOrderIndex is EARLIER in the tab sequence, so the authored order
  // is [infoButton, pageTitle, card, controlChart, upperText, lowerBox].
  // Positions are laid out top-to-bottom in the OPPOSITE order (infoButton
  // is placed at the very bottom), so the layout-inferred order starts with
  // pageTitle, not infoButton - a real, detectable mismatch at position 1.
  const infoButton = makeVisual({ id: "infoButton", type: "actionButton", tabOrderIndex: 25, x: 1100, y: 660, width: 100, height: 40 });
  const pageTitle = makeVisual({ id: "pageTitle", type: "textbox", tabOrderIndex: 20, x: 20, y: 10, width: 400, height: 40 });
  const card = makeVisual({ id: "card", type: "cardVisual", tabOrderIndex: 15, x: 20, y: 80, width: 200, height: 120 });
  const controlChart = makeVisual({ id: "controlChart", type: "lineChart", tabOrderIndex: 10, x: 20, y: 220, width: 600, height: 300 });
  const upperText = makeVisual({ id: "upperText", type: "textbox", tabOrderIndex: 5, x: 20, y: 540, width: 300, height: 40 });
  const lowerBox = makeVisual({ id: "lowerBox", type: "shape", tabOrderIndex: 0, x: 20, y: 600, width: 300, height: 40 });
  const page = makePage("PageSix", [infoButton, pageTitle, card, controlChart, upperText, lowerBox]);

  const result = analyzeReport([page]);
  const found = tabOrderIssues("PageSix", result).filter((i) => i.id.startsWith("PageSix-tab-layout-mismatch"));

  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warn");
  assert.equal(found[0].title, "Tab order may not follow the layout");
  assert.match(found[0].detail, /^Position 1 is "Button \(no title, no fields\)" but the layout suggests "Text box \(no title, no fields\)"\.$/);
  assert.match(found[0].fix, /1\. Text box \(no title, no fields\)/);
});

test("a flat page whose authored order already matches its top-to-bottom layout is not flagged", () => {
  const topText = makeVisual({ id: "topText", type: "textbox", tabOrderIndex: 30, x: 20, y: 10, width: 400, height: 40 });
  const midCard = makeVisual({ id: "midCard", type: "cardVisual", tabOrderIndex: 20, x: 20, y: 80, width: 200, height: 120 });
  const botChart = makeVisual({ id: "botChart", type: "barChart", tabOrderIndex: 10, x: 20, y: 220, width: 600, height: 300 });
  const page = makePage("PageMatch", [topText, midCard, botChart]);

  const result = analyzeReport([page]);
  const found = tabOrderIssues("PageMatch", result).filter((i) => i.id.startsWith("PageMatch-tab-layout-mismatch"));

  assert.deepEqual(found, []);
});

test("a page with only one authored visual at a level is not flagged (nothing to compare)", () => {
  const onlyVisual = makeVisual({ id: "onlyVisual", type: "barChart", tabOrderIndex: 1, x: 20, y: 20, width: 400, height: 300 });
  const page = makePage("PageOne", [onlyVisual]);

  const result = analyzeReport([page]);
  assert.deepEqual(tabOrderIssues("PageOne", result), []);
});

test("duplicate tab order values are scoped per sibling level: a top-level visual and a group child sharing a raw value is NOT a duplicate", () => {
  const topDup = makeVisual({ id: "topDup", type: "barChart", tabOrderIndex: 7, x: 700, y: 50, width: 300, height: 200 });
  const childDup1 = makeVisual({ id: "childDup1", type: "cardVisual", tabOrderIndex: 7, parentGroupId: "groupC", x: 60, y: 60, width: 100, height: 80 });
  const childDup2 = makeVisual({ id: "childDup2", type: "cardVisual", tabOrderIndex: 9, parentGroupId: "groupC", x: 60, y: 150, width: 100, height: 80 });
  const groupC = makeVisual({ id: "groupC", type: "visualGroup", isHiddenFromTabOrder: true, x: 50, y: 50, width: 400, height: 300, groupDisplayName: "Group C" });
  const page = makePage("PageDup1", [topDup, childDup1, childDup2, groupC]);

  const result = analyzeReport([page]);
  const duplicates = tabOrderIssues("PageDup1", result).filter((i) => i.id.includes("duplicate"));

  assert.deepEqual(duplicates, []);
});

test("duplicate tab order values shared by two visuals genuinely at the same sibling level (inside the same group) ARE flagged, scoped to that group", () => {
  const topDup = makeVisual({ id: "topDup", type: "barChart", tabOrderIndex: 7, x: 700, y: 50, width: 300, height: 200 });
  const childDup1 = makeVisual({ id: "childDup1", type: "cardVisual", tabOrderIndex: 7, parentGroupId: "groupC", x: 60, y: 60, width: 100, height: 80 });
  const childDup2 = makeVisual({ id: "childDup2", type: "cardVisual", tabOrderIndex: 9, parentGroupId: "groupC", x: 60, y: 150, width: 100, height: 80 });
  const childDup3 = makeVisual({ id: "childDup3", type: "cardVisual", tabOrderIndex: 9, parentGroupId: "groupC", x: 250, y: 60, width: 100, height: 80 });
  const groupC = makeVisual({ id: "groupC", type: "visualGroup", isHiddenFromTabOrder: true, x: 50, y: 50, width: 400, height: 300, groupDisplayName: "Group C" });
  const page = makePage("PageDup2", [topDup, childDup1, childDup2, childDup3, groupC]);

  const result = analyzeReport([page]);
  const duplicates = tabOrderIssues("PageDup2", result).filter((i) => i.id.includes("duplicate"));

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].id, "PageDup2-tab-duplicate-9-groupC");
  assert.equal(duplicates[0].severity, "fail");
  assert.match(duplicates[0].detail, /2 elements share tab order 9/);
});

test("a decorative visual with a non-hidden tab order is still flagged even when nested several groups deep", () => {
  const outer = makeVisual({ id: "outer", type: "visualGroup", isHiddenFromTabOrder: true, x: 0, y: 0, width: 800, height: 600, groupDisplayName: "Outer" });
  const inner = makeVisual({ id: "inner", type: "visualGroup", isHiddenFromTabOrder: true, parentGroupId: "outer", x: 10, y: 10, width: 400, height: 300, groupDisplayName: "Inner" });
  const deepDecorative = makeVisual({ id: "deepDecorative", type: "shape", tabOrderIndex: 4, parentGroupId: "inner", x: 20, y: 20, width: 50, height: 50, isDecorative: true });
  const page = makePage("PageDeep", [outer, inner, deepDecorative]);

  const result = analyzeReport([page]);
  const found = tabOrderIssues("PageDeep", result).filter((i) => i.id === "deepDecorative-tab-decorative-focusable");

  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warn");
});
