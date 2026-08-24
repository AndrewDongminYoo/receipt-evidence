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

test("a multi-line excerpt is boxed by the rectangle enclosing every line it spans", () => {
  // The Korean item shape: name, barcode and price on three lines. The box has
  // to cover all three, or the reader is pointed at part of the evidence.
  const lines = [
    { text: "하리보)푸르티부시젤리100", frame: { x: 20, y: 100, width: 300, height: 20 } },
    { text: "4001686375754", frame: { x: 10, y: 130, width: 200, height: 20 } },
    { text: "2,500", frame: { x: 240, y: 130, width: 80, height: 24 } },
  ];

  assert.deepEqual(
    anchorToLines("하리보)푸르티부시젤리100\n4001686375754\n2,500", lines),
    { x: 10, y: 100, width: 310, height: 54 },
    "left-most edge, top-most edge, and out to the furthest right and bottom",
  );
  assert.deepEqual(
    anchorToLines("4001686375754", lines),
    { x: 10, y: 130, width: 200, height: 20 },
    "a single-line excerpt still gets that line's own frame, unchanged",
  );
});
