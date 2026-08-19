import assert from "node:assert/strict";
import test from "node:test";
import { extract } from "../src/extract.ts";

const PAGE = {
  text: "GS25\n2026.07.02 20:20:50\n커피 4,500\n합계 4,500\n",
  lines: [
    { text: "GS25", frame: { x: 0, y: 0, width: 10, height: 10 } },
    { text: "커피 4,500", frame: { x: 0, y: 20, width: 10, height: 10 } },
    { text: "합계 4,500", frame: { x: 0, y: 40, width: 10, height: 10 } },
  ],
};

test("a model item backed by real evidence is verified and anchored", async () => {
  const client = {
    async complete() {
      return {
        items: [
          { name: "커피", quantity: 1, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } },
        ],
      };
    },
  };

  const result = await extract({ pages: [PAGE] }, client, new Date(2026, 6, 20));

  assert.equal(result.items[0].verified, true);
  assert.deepEqual(result.items[0].evidence.box, { x: 0, y: 20, width: 10, height: 10 });
  assert.equal(result.arithmetic.agrees, true);
});

test("a fabricated model item survives as unverified, never as fact", async () => {
  const client = {
    async complete() {
      return {
        items: [
          { name: "위스키", quantity: 1, amountMinor: 90000, evidence: { pageIndex: 0, excerpt: "위스키 90,000" } },
        ],
      };
    },
  };

  const result = await extract({ pages: [PAGE] }, client, new Date(2026, 6, 20));

  assert.equal(result.items[0].verified, false);
  assert.deepEqual(result.unverified, ["items[0]"]);
  assert.equal(result.arithmetic.agrees, false);
});

test("the parser's own fields are marked as coming from the parser", async () => {
  const client = { async complete() { return { items: [] }; } };

  const result = await extract({ pages: [PAGE] }, client, new Date(2026, 6, 20));

  assert.equal(result.fields.paidTotal?.source, "parser");
  assert.equal(result.fields.paidTotal?.verified, true);
  assert.equal(result.modelReply.accepted, true);
});

test("a malformed reply is rejected and reported, not silently emptied", async () => {
  const client = {
    async complete() {
      // Missing `evidence`, which ModelReplySchema requires on every item.
      return { items: [{ name: "커피", amountMinor: 4500 }] };
    },
  };

  const result = await extract({ pages: [PAGE] }, client, new Date(2026, 6, 20));

  assert.equal(result.modelReply.accepted, false);
  assert.ok(!result.modelReply.accepted && result.modelReply.reason.length > 0);
  assert.deepEqual(result.items, []);
  // Existing behaviour is unchanged: a rejected reply still leaves the
  // parser's own fields standing.
  assert.equal(result.fields.paidTotal?.source, "parser");
  assert.equal(result.fields.paidTotal?.verified, true);
});
