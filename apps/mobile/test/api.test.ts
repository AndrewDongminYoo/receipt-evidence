import assert from "node:assert/strict";
import test from "node:test";
import { apiBaseUrl } from "../src/api.ts";

test("the API host follows the dev server the app is already talking to", () => {
  // The default used to be http://localhost:3000, which on a phone is the
  // phone — the request could not succeed on the one device the app exists
  // for. hostUri is the Metro address the bundle was loaded from, so it is
  // by construction an address this device can reach.
  assert.equal(apiBaseUrl(undefined, "172.30.1.11:8081"), "http://172.30.1.11:3000");
  assert.equal(apiBaseUrl(undefined, "exp://172.30.1.11:8081"), "http://172.30.1.11:3000");
  assert.equal(apiBaseUrl(undefined, "172.30.1.11:8081/_expo/loading"), "http://172.30.1.11:3000");
  // The shape that actually reaches it: SourceCode.scriptURL, the bundle URL
  // the app booted from. Taken verbatim from this project's dev server.
  assert.equal(
    apiBaseUrl(
      undefined,
      "http://172.30.1.11:8081/apps/mobile/index.bundle?platform=ios&dev=true&hot=false&transform.engine=hermes",
    ),
    "http://172.30.1.11:3000",
  );
});

test("a release build's embedded bundle yields no host, so nothing is derived from it", () => {
  // scriptURL is a file:// path when the bundle ships inside the app. It must
  // not be mistaken for a dev server, and it must not produce a bogus host.
  assert.equal(
    apiBaseUrl(undefined, "file:///var/containers/Bundle/Application/ABC/ReceiptEvidence.app/main.jsbundle"),
    "http://localhost:3000",
  );
});

test("an explicit EXPO_PUBLIC_API_URL wins over the derived host", () => {
  assert.equal(apiBaseUrl("https://receipts.example.com", "172.30.1.11:8081"), "https://receipts.example.com");
  assert.equal(apiBaseUrl("http://10.0.0.2:3000/", undefined), "http://10.0.0.2:3000");
  // An env var that Metro inlined as an empty string is not a configuration.
  assert.equal(apiBaseUrl("", "172.30.1.11:8081"), "http://172.30.1.11:3000");
  assert.equal(apiBaseUrl("   ", "172.30.1.11:8081"), "http://172.30.1.11:3000");
});

test("with no dev server host it falls back to localhost, which is right on a simulator", () => {
  assert.equal(apiBaseUrl(undefined, undefined), "http://localhost:3000");
  assert.equal(apiBaseUrl(undefined, ""), "http://localhost:3000");
});

test("an IPv6 dev server host keeps its brackets", () => {
  assert.equal(apiBaseUrl(undefined, "[fe80::1]:8081"), "http://[fe80::1]:3000");
});
