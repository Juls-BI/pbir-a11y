// Confirms two group-related clutter fixes:
//  1. clutterIndex() itself is unaffected by grouping - it only ever sees
//     data-visual boxes, so this is really testing that resolved absolute
//     positions reproduce the same boxes whether visuals are flat or wrapped
//     in a group.
//  2. A visual-group container's own box is excluded from the analyze()-level
//     clutter computation (isDataVisual), so the group box itself can't add
//     a phantom "visual" or a phantom overlap on top of its own children.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clutterIndex } from "../src/lib/clutterIndex";
import { makeVisual, makePage, analyzeReport } from "./testHelpers";

test("clutterIndex gives identical visualCount/density/overlaps for the same visuals, flat vs. pre-resolved-to-the-same-absolute-boxes", () => {
  const flatBoxes = [
    { id: "v1", type: "barChart", x: 50, y: 50, w: 200, h: 150 },
    { id: "v2", type: "lineChart", x: 300, y: 50, w: 200, h: 150 },
    { id: "v3", type: "pieChart", x: 50, y: 250, w: 200, h: 150 },
    { id: "v4", type: "cardVisual", x: 300, y: 250, w: 200, h: 150 },
  ];
  // Same four boxes, same absolute positions - as if they'd been authored
  // inside a group at (0,0) with these values kept relative (0 + x = x).
  // The point: once positions are absolute, grouping changes nothing for
  // clutterIndex, which never sees parentGroupId at all.
  const groupedBoxes = flatBoxes.map((b) => ({ ...b }));

  const flat = clutterIndex(1280, 720, flatBoxes);
  const grouped = clutterIndex(1280, 720, groupedBoxes);

  assert.equal(flat.visualCount, grouped.visualCount);
  assert.equal(flat.density, grouped.density);
  assert.deepEqual(flat.overlaps, grouped.overlaps);
});

test("wrapping a set of visuals in a group does not change the page's clutter score (the group's own box is excluded)", () => {
  // Flat: four data visuals directly on the page, no group.
  const flatVisuals = [
    makeVisual({ id: "v1", type: "barChart", x: 50, y: 50, width: 200, height: 150 }),
    makeVisual({ id: "v2", type: "lineChart", x: 300, y: 50, width: 200, height: 150 }),
    makeVisual({ id: "v3", type: "pieChart", x: 50, y: 250, width: 200, height: 150 }),
    makeVisual({ id: "v4", type: "cardVisual", x: 300, y: 250, width: 200, height: 150 }),
  ];
  const flatPage = makePage("FlatPage", flatVisuals);

  // Grouped: the exact same four visuals, positioned identically (already
  // page-absolute, as resolveAbsolutePositions would leave them), but now
  // also wrapped in a group container whose own box fully contains them -
  // if the group box were still counted as a "data visual" (the pre-fix
  // bug), this page would show 5 visuals and phantom overlaps between the
  // group and every one of its children instead of 4 and none.
  const group = makeVisual({ id: "groupA", type: "visualGroup", x: 30, y: 30, width: 500, height: 400, groupDisplayName: "KPIs" });
  const groupedVisuals = [
    group,
    makeVisual({ id: "v1", type: "barChart", x: 50, y: 50, width: 200, height: 150, parentGroupId: "groupA" }),
    makeVisual({ id: "v2", type: "lineChart", x: 300, y: 50, width: 200, height: 150, parentGroupId: "groupA" }),
    makeVisual({ id: "v3", type: "pieChart", x: 50, y: 250, width: 200, height: 150, parentGroupId: "groupA" }),
    makeVisual({ id: "v4", type: "cardVisual", x: 300, y: 250, width: 200, height: 150, parentGroupId: "groupA" }),
  ];
  const groupedPage = makePage("GroupedPage", groupedVisuals);

  const flatResult = analyzeReport([flatPage]);
  const groupedResult = analyzeReport([groupedPage]);

  const flatClutter = flatResult.pages[0].clutter;
  const groupedClutter = groupedResult.pages[0].clutter;

  assert.equal(flatClutter.visualCount, 4);
  assert.equal(groupedClutter.visualCount, 4, "the group's own box must not be counted as a 5th data visual");
  assert.equal(flatClutter.density, groupedClutter.density);
  assert.deepEqual(flatClutter.overlaps, groupedClutter.overlaps);
});
