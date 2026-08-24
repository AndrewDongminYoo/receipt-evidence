// The floor decision is the one piece of app logic that changes what leaves
// the device, so it gets a test that runs without a simulator. `capture.ts`
// imports the scanner for types only, which node's type stripping removes —
// nothing here loads React Native.
import assert from "node:assert/strict";
import test from "node:test";
import { clearsFloor, scaleFrame } from "../src/capture.ts";

// The package's DEFAULT_OCR_FLOOR is `{ minTextLength: 12, minLines: 2,
// minConfidence: 0 }`. Its lengths are used verbatim here, but minConfidence
// is raised to 0.5: at the real default of 0 no confidence can fall below it,
// so a test using the shipped value could not tell a working confidence check
// from a missing one. The constant is restated rather than imported because
// importing it pulls React Native in — which is why capture.ts takes the
// floor as a parameter. App.tsx passes the real DEFAULT_OCR_FLOOR.
const FLOOR = { minTextLength: 12, minLines: 2, minConfidence: 0.5 };

test("clearsFloor keeps a page's image on the device only when its text can carry the work", () => {
  assert.equal(
    clearsFloor({ textLength: 400, lineCount: 30, confidence: 0.9 }, FLOOR),
    true,
    "a clean scan clears every threshold",
  );
  assert.equal(
    clearsFloor({ textLength: 4, lineCount: 30, confidence: 0.9 }, FLOOR),
    false,
    "too little text recognised — the image has to travel",
  );
  assert.equal(
    clearsFloor({ textLength: 400, lineCount: 1, confidence: 0.9 }, FLOOR),
    false,
    "one line is not a receipt",
  );
  assert.equal(
    clearsFloor({ textLength: 400, lineCount: 30, confidence: 0.2 }, FLOOR),
    false,
    "recognised plenty, but the recogniser does not believe it",
  );
});

test("clearsFloor fails closed when OCR reported nothing, and mirrors the package on an absent confidence", () => {
  assert.equal(
    clearsFloor(undefined, FLOOR),
    false,
    "no quality block means OCR never ran — there is no text to trust",
  );
  assert.equal(
    clearsFloor({ textLength: 400, lineCount: 30 }, FLOOR),
    true,
    "an absent confidence satisfies the threshold, as the package's own gate does",
  );
});

test("scaleFrame maps OCR pixels onto the width the image was actually rendered at", () => {
  const frame = { x: 100, y: 200, width: 50, height: 20 };
  assert.deepEqual(
    scaleFrame(frame, 1000, 500),
    { x: 50, y: 100, width: 25, height: 10 },
    "half the width means half of every coordinate, y included",
  );
  assert.deepEqual(scaleFrame(frame, 1000, 1000), frame, "rendered at native width, nothing moves");
  assert.deepEqual(
    scaleFrame(frame, 0, 500),
    { x: 0, y: 0, width: 0, height: 0 },
    "an unmeasured image would divide by zero and paint the box over the screen",
  );
});
