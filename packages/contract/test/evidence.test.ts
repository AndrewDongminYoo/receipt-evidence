import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";

test("evidenceLines drops blanks and indexes what survives", () => {
  const lines = evidenceLines("Mono Market\n\n  Total 189,000  \n");

  assert.deepEqual(lines, [
    { lineIndex: 0, text: "Mono Market" },
    { lineIndex: 1, text: "Total 189,000" },
  ]);
});

test("evidenceLines returns nothing for whitespace-only input", () => {
  assert.deepEqual(evidenceLines("   \n\n"), []);
});
