// Unit tests for resolveAbsolutePositions (pbixParser.ts) - the function that
// turns a group-relative x/y into a page-absolute one by walking the
// parentGroupId chain. Pure function, tested directly against in-memory
// ParsedVisual objects (see makeVisual in testHelpers.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAbsolutePositions } from "../src/lib/pbixParser";
import { makeVisual } from "./testHelpers";

test("a visual with no parentGroupId is left at its own x/y (already page-absolute)", () => {
  const v = makeVisual({ id: "v1", type: "barChart", x: 123, y: 45 });
  const [resolved] = resolveAbsolutePositions([v]);
  assert.equal(resolved.x, 123);
  assert.equal(resolved.y, 45);
});

test("a visual inside one group is offset by that group's own position", () => {
  const group = makeVisual({ id: "groupA", type: "visualGroup", x: 20, y: 20 });
  const child = makeVisual({ id: "child", type: "cardVisual", x: 30, y: 30, parentGroupId: "groupA" });
  const [resolvedGroup, resolvedChild] = resolveAbsolutePositions([group, child]);
  assert.equal(resolvedGroup.x, 20);
  assert.equal(resolvedGroup.y, 20);
  assert.equal(resolvedChild.x, 50);
  assert.equal(resolvedChild.y, 50);
});

test("a visual nested two groups deep sums every ancestor group's own position", () => {
  const outer = makeVisual({ id: "outer", type: "visualGroup", x: 100, y: 200 });
  const inner = makeVisual({ id: "inner", type: "visualGroup", x: 10, y: 10, parentGroupId: "outer" });
  const leaf = makeVisual({ id: "leaf", type: "cardVisual", x: 5, y: 5, parentGroupId: "inner" });
  const resolved = resolveAbsolutePositions([outer, inner, leaf]);
  const byId = new Map(resolved.map((v) => [v.id, v]));
  // inner: 100+10, 200+10
  assert.equal(byId.get("inner")!.x, 110);
  assert.equal(byId.get("inner")!.y, 210);
  // leaf: (100+10)+5, (200+10)+5
  assert.equal(byId.get("leaf")!.x, 115);
  assert.equal(byId.get("leaf")!.y, 215);
});

test("a parentGroupName referencing a group that doesn't exist on the page degrades to treating the visual as top-level", () => {
  const orphan = makeVisual({ id: "orphan", type: "shape", x: 40, y: 60, parentGroupId: "noSuchGroup" });
  const [resolved] = resolveAbsolutePositions([orphan]);
  assert.equal(resolved.x, 40);
  assert.equal(resolved.y, 60);
});

test("does not infinitely recurse on a cyclic parent chain (defensive - should never occur in real data)", () => {
  const a = makeVisual({ id: "a", type: "visualGroup", x: 10, y: 10, parentGroupId: "b" });
  const b = makeVisual({ id: "b", type: "visualGroup", x: 20, y: 20, parentGroupId: "a" });
  const resolved = resolveAbsolutePositions([a, b]);
  // No assertion on the exact numbers (a cycle has no "correct" answer) -
  // the point is that this returns rather than stack-overflowing.
  assert.equal(resolved.length, 2);
});
