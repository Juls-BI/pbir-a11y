// Direct unit tests for assignTabOrderRanks (pbixParser.ts) - the fix for the
// tabOrderIndex direction ambiguity: normalisePowerBiLayoutTabOrder rewrites
// tabOrderIndex into an ascending (1 = first) rank ONLY for pages whose raw
// values are all unique, non-negative multiples of 1000, and otherwise
// leaves it as the raw value, where empirically descending (largest = first)
// is correct - the same field means opposite things depending on which case
// applies. tabOrderRank removes that ambiguity: it's always "ascending, 1 =
// first", computed once per page from the untouched raw value, with the same
// algorithm regardless of the raw values' magnitude.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assignTabOrderRanks } from "../src/lib/pbixParser";
import { makeVisual } from "./testHelpers";

test("assignTabOrderRanks: real flat-page sample (25/20/15/10/5/0) ranks 1..6 in that same visual order", () => {
  const visuals = [
    makeVisual({ id: "infoButton", type: "actionButton", tabOrderIndex: 25 }),
    makeVisual({ id: "pageTitle", type: "textbox", tabOrderIndex: 20 }),
    makeVisual({ id: "card", type: "cardVisual", tabOrderIndex: 15 }),
    makeVisual({ id: "controlChart", type: "lineChart", tabOrderIndex: 10 }),
    makeVisual({ id: "upperText", type: "textbox", tabOrderIndex: 5 }),
    makeVisual({ id: "lowerBox", type: "shape", tabOrderIndex: 0 }),
  ];

  const ranked = assignTabOrderRanks(visuals);
  const rankById = new Map(ranked.map((v) => [v.id, v.tabOrderRank]));

  assert.equal(rankById.get("infoButton"), 1);
  assert.equal(rankById.get("pageTitle"), 2);
  assert.equal(rankById.get("card"), 3);
  assert.equal(rankById.get("controlChart"), 4);
  assert.equal(rankById.get("upperText"), 5);
  assert.equal(rankById.get("lowerBox"), 6);
});

test("assignTabOrderRanks: grouped-style sample (2000/1000/0) ranks 1..3 in that same visual order - identical algorithm, no special-casing for magnitude", () => {
  const visuals = [
    makeVisual({ id: "childA", type: "cardVisual", tabOrderIndex: 2000 }),
    makeVisual({ id: "childB", type: "cardVisual", tabOrderIndex: 1000 }),
    makeVisual({ id: "childC", type: "cardVisual", tabOrderIndex: 0 }),
  ];

  const ranked = assignTabOrderRanks(visuals);
  const rankById = new Map(ranked.map((v) => [v.id, v.tabOrderRank]));

  assert.equal(rankById.get("childA"), 1);
  assert.equal(rankById.get("childB"), 2);
  assert.equal(rankById.get("childC"), 3);
});

test("assignTabOrderRanks leaves tabOrderIndex/tabOrder completely untouched", () => {
  const visuals = [
    makeVisual({ id: "a", type: "barChart", tabOrderIndex: 25 }),
    makeVisual({ id: "b", type: "barChart", tabOrderIndex: 5 }),
  ];
  const ranked = assignTabOrderRanks(visuals);
  const byId = new Map(ranked.map((v) => [v.id, v]));

  // Same raw display values as before - nothing that reads tabOrderIndex/
  // tabOrder for display (or any pre-existing consumer) sees any change.
  assert.equal(byId.get("a")!.tabOrderIndex, 25);
  assert.equal(byId.get("a")!.tabOrder, 25);
  assert.equal(byId.get("b")!.tabOrderIndex, 5);
  assert.equal(byId.get("b")!.tabOrder, 5);
});

test("assignTabOrderRanks skips hidden and unauthored visuals, leaving their tabOrderRank null", () => {
  const hidden = makeVisual({ id: "hidden", type: "shape", tabOrderIndex: 99, isHiddenFromTabOrder: true });
  const unauthored = makeVisual({ id: "unauthored", type: "shape" });
  const authored = makeVisual({ id: "authored", type: "shape", tabOrderIndex: 1 });

  const ranked = assignTabOrderRanks([hidden, unauthored, authored]);
  const byId = new Map(ranked.map((v) => [v.id, v.tabOrderRank]));

  assert.equal(byId.get("hidden"), null);
  assert.equal(byId.get("unauthored"), null);
  assert.equal(byId.get("authored"), 1);
});
