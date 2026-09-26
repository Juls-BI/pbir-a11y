import { test } from "node:test";
import assert from "node:assert/strict";
import { findCollisions } from "../src/lib/colourblindUtils";

// findCollisions() is exercised directly, not through analyze(): rulesEngine.ts
// deliberately never calls it (colourblind is a UI-simulator toggle now, not
// an automated rule — see the commented-out call in analyze()), so there is
// no analyze()-level "colourblind" issue to test against.

test("a red/dark-green pair known to collide under deuteranopia is reported", () => {
  const collisions = findCollisions(["#FF0000", "#008000"]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].type, "deuteranopia");
  assert.equal(collisions[0].collision, true);
});

test("a clearly distinguishable palette reports no collisions", () => {
  const collisions = findCollisions(["#000000", "#FFFFFF"]);
  assert.deepEqual(collisions, []);
});
