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

test("an excerpt matching more than one line is not boxed at all", () => {
  // total.ts documents this receipt shape: stacked labels over stacked values,
  // where the paid total and the card line print the same amount. Boxing the
  // first match drew the VISA row's evidence on the TOTAL row — right value,
  // wrong pixels, no signal.
  const lines = [
    { text: "SUBTOTAL", frame: { x: 0, y: 0, width: 10, height: 10 } },
    { text: "6.03", frame: { x: 0, y: 30, width: 10, height: 10 } },
    { text: "6.03", frame: { x: 0, y: 60, width: 10, height: 10 } },
  ];

  assert.equal(anchorToLines("6.03", lines), null, "two candidate rows means the box is unknown, not the first");
  assert.deepEqual(
    anchorToLines("SUBTOTAL", lines),
    { x: 0, y: 0, width: 10, height: 10 },
    "an unambiguous excerpt is still boxed",
  );
});
