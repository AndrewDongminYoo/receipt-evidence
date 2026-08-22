// The endpoint's boundary: what it does when the request is malformed, and
// what its validator lets through. `extract()` and the guards are covered by
// extract.test.ts.
//
// No network. The two POST cases below both return before the model client is
// reached; everything about which requests are ACCEPTED is asserted against
// `isRequestBody` directly, because a test that got as far as the model call
// would be a test that dials OpenAI — and nothing in this repository does.
import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/extract/route.ts";
import { isRequestBody } from "../src/request.ts";

// route.ts reads the key inside POST, not at import time, so setting it here
// is enough.
process.env.OPENAI_API_KEY = "test-key-never-sent";

function post(body: string): Request {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const VALID_PAGE = {
  text: "GS25\n합계 4,500\n",
  lines: [{ text: "합계 4,500", frame: { x: 0, y: 0, width: 10, height: 10 } }],
};

test("a malformed body is a bad request, not an unhandled crash", async () => {
  const response = await POST(post("{not json at all"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "request body is not valid JSON" });
});

test("an empty page list is rejected rather than sent to the model", async () => {
  const response = await POST(post(JSON.stringify({ pages: [] })));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "no pages to extract from" });
});

test("isRequestBody rejects a page shape that would crash the parser", () => {
  // Each of these used to pass validation and die inside analyze() or
  // anchorToLines instead, surfacing as a 502 with a raw TypeError message.
  assert.equal(isRequestBody({ text: "TOTAL 12,900" }), false, "no pages key at all");
  assert.equal(isRequestBody({ pages: [{}] }), false, "a page with no text");
  assert.equal(isRequestBody({ pages: [null] }), false, "a null page");
  assert.equal(isRequestBody({ pages: [{ text: 5, lines: [] }] }), false, "text is not a string");
  assert.equal(isRequestBody({ pages: [{ text: "x" }] }), false, "no lines array");
  assert.equal(isRequestBody({ pages: [{ text: "x", lines: [1, 2, 3] }] }), false, "lines are not OCR lines");
  assert.equal(
    isRequestBody({ pages: [{ text: "x", lines: [{ text: "x", frame: { x: 0, y: 0, width: 1 } }] }] }),
    false,
    "a frame missing a dimension",
  );
  assert.equal(
    isRequestBody({ pages: [{ ...VALID_PAGE, imageDataUrl: 42 }] }),
    false,
    "an image that is not a data URL string",
  );
});

test("isRequestBody accepts the requests the two clients actually send", () => {
  // Without this the validator could reject everything and every assertion
  // above would still pass. The demo page sends the first shape; the mobile
  // app sends the second when a page falls below the OCR floor.
  assert.equal(isRequestBody({ pages: [VALID_PAGE] }), true);
  assert.equal(isRequestBody({ pages: [{ ...VALID_PAGE, imageDataUrl: "data:image/jpeg;base64,QUJD" }] }), true);
  assert.equal(isRequestBody({ pages: [{ text: "", lines: [] }] }), true, "an empty page is a caller's problem, not malformed");
  assert.equal(isRequestBody({ pages: [VALID_PAGE, VALID_PAGE] }), true, "a multi-page scan");
});
