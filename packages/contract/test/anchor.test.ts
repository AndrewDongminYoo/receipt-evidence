import assert from "node:assert/strict";
import test from "node:test";
import { anchorToLines } from "../src/anchor.ts";

const LINES = [
  { text: "GS25", frame: { x: 10, y: 10, width: 100, height: 20 } },
  { text: "합계 14,800", frame: { x: 10, y: 40, width: 200, height: 20 } },
];

test("anchorToLines finds the box of the quoted line", () => {
  assert.deepEqual(anchorToLines("합계 14,800", LINES), { x: 10, y: 40, width: 200, height: 20 });
});

test("anchorToLines matches after whitespace and NFKC normalisation", () => {
  assert.deepEqual(anchorToLines("합계  14,800 ", LINES), { x: 10, y: 40, width: 200, height: 20 });
});

test("anchorToLines returns null when no line carries the excerpt", () => {
  assert.equal(anchorToLines("합계 99,999", LINES), null);
});
