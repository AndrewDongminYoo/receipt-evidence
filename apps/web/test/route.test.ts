// The endpoint's error boundary. `extract()` and the guards are covered by
// extract.test.ts; what is checked here is only what the route does when the
// request or the model call goes wrong, because those paths return a status
// code and a message a caller depends on.
//
// No network: the route reads OPENAI_API_KEY and builds a client, but every
// case below returns before the client is ever called.
import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/extract/route.ts";

// route.ts reads the key inside POST, not at import time, so setting it here
// is enough — and every case below returns before the client it builds is
// ever called.
process.env.OPENAI_API_KEY = "test-key-never-sent";

function post(body: string): Request {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

test("a malformed body is a bad request, not an unhandled crash", async () => {
  const response = await POST(post("{not json at all"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "request body is not valid JSON" });
});

test("a well-formed body with the wrong shape is also a bad request", async () => {
  const response = await POST(post(JSON.stringify({ text: "TOTAL 12,900" })));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "expected { pages: [...] }" });
});
