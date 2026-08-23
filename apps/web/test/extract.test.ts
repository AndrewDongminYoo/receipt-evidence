import assert from "node:assert/strict";
import test from "node:test";
import { extract, toIsoDate } from "../src/extract.ts";

const PAGE = {
  text: "GS25\n2026.07.02 20:20:50\n커피 4,500\n합계 4,500\n",
  lines: [
    { text: "GS25", frame: { x: 0, y: 0, width: 10, height: 10 } },
    { text: "커피 4,500", frame: { x: 0, y: 20, width: 10, height: 10 } },
    { text: "합계 4,500", frame: { x: 0, y: 40, width: 10, height: 10 } },
  ],
};

test("a model item backed by real evidence is verified and anchored", async () => {
  // No `quantity`: the line reads `커피 4,500` and states no count, and the
  // schema makes quantity optional exactly so the model omits what it cannot
  // read. This fixture used to claim `quantity: 1` while calling itself
  // "backed by real evidence" — a value the cited line does not carry, which
  // is the shape this project exists to catch. The guard now catches it, and
  // the test below pins that; the fixture was corrected rather than the rule.
  const client = {
    async complete() {
      return {
        items: [{ name: "커피", amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } }],
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
  // Pins the field end to end, not just toIsoDate in isolation — PAGE's
  // "2026.07.02 20:20:50" line must come back as 2026-07-02, never shifted
  // by a day (see the toIsoDate regression test below for why that's live).
  assert.equal(result.fields.purchaseDate?.value, "2026-07-02");
});

// dates.ts constructs purchaseDate with `new Date(year, month - 1, day)` —
// LOCAL midnight — so toIsoDate has to read it back through local getters,
// not toISOString(), which reinterprets the instant as UTC and can shift
// the calendar day. The shift only goes one direction per zone sign, so one
// input cannot fail in both: a UTC+ zone (Seoul) shifts a LOCAL-MIDNIGHT
// date backward (00:00 minus 9h crosses into the previous UTC day), while a
// UTC- zone (New York) never shifts a midnight date at all (00:00 plus 4h
// stays on the same UTC day) — it only shifts a LATE local time forward
// across the boundary instead. Each zone below uses the time-of-day that
// actually crosses the UTC day boundary in that zone's direction, so the
// old (broken) implementation fails in both.
test("toIsoDate reads a locally-constructed date back as the same calendar day, across UTC offsets", () => {
  const originalTz = process.env.TZ;
  try {
    // Zone must be set BEFORE its Date is constructed — a Date's internal
    // epoch is fixed from its local components at construction time, so
    // building it under the wrong TZ bakes in the wrong instant.
    const cases: [zone: string, hour: number][] = [
      ["Asia/Seoul", 0], // UTC+9: local midnight crosses backward
      ["America/New_York", 23], // UTC-4: late local time crosses forward
    ];
    for (const [zone, hour] of cases) {
      process.env.TZ = zone; // Node re-reads TZ per Date construction.
      const date = new Date(2026, 6, 2, hour, 0, 0);
      assert.equal(toIsoDate(date), "2026-07-02", `${zone}: local calendar day must round-trip`);
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
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

// A USD page, because the two defects below only showed up on one: half the
// corpus is English and neither was caught until a review probe ran the
// pipeline rather than reading it.
// No date line on purpose: the model is only ever asked for what the parser
// could not derive, so a page whose date the parser reads would never exercise
// the model's date path at all.
const USD_PAGE = {
  text: "BLUE BOTTLE\nSANDWICH  12.99\nTOTAL  12.99\n",
  lines: [],
};

test("a fabricated string or date is marked unverified, whatever real line it quotes", async () => {
  // Both values below quote a line that genuinely exists — the hallucination
  // this project is actually about. Until 2026-08-22 nothing checked a string
  // or date value against its excerpt at all, so both shipped as
  // `verified: true` with an empty `unverified` list.
  const client = {
    complete: async () => ({
      purchaseDate: { value: "1999-01-01", evidence: { pageIndex: 0, excerpt: "BLUE BOTTLE" } },
      reference: { value: "TOTALLY-MADE-UP-9999", evidence: { pageIndex: 0, excerpt: "TOTAL  12.99" } },
      items: [],
    }),
  };
  const result = await extract({ pages: [USD_PAGE] }, client, new Date(2026, 7, 22));

  assert.equal(result.modelReply.accepted, true, "the reply is well-formed; this is about values, not shape");
  assert.equal(result.fields.purchaseDate?.verified, false, "a date that line does not state");
  assert.equal(result.fields.purchaseDate?.value, "1999-01-01", "kept, never dropped");
  assert.equal(result.fields.reference?.verified, false, "a reference that line does not state");
  assert.deepEqual(result.unverified, ["fields.purchaseDate", "fields.reference"]);
});

test("a correct amount in minor units verifies against the decimal its receipt prints", async () => {
  // The mirror-image defect, and the more damaging one: the guard compared
  // 1299 against the literal "12.99" and failed every honest USD amount, so
  // `unverified` filled up with correct values and stopped meaning anything.
  const client = {
    complete: async () => ({
      items: [{ name: "SANDWICH", amountMinor: 1299, evidence: { pageIndex: 0, excerpt: "SANDWICH  12.99" } }],
    }),
  };
  const result = await extract({ pages: [USD_PAGE] }, client, new Date(2026, 7, 22));

  assert.equal(result.fields.currency, "USD");
  assert.equal(result.items[0]?.verified, true, "the excerpt states 12.99 and 1299 is 12.99 in minor units");
  assert.deepEqual(result.unverified, []);
});

test("an item's name and quantity are checked against its line, not just its amount", async () => {
  // The excerpt is real and the amount is genuinely on it — only the name and
  // quantity are invented. Checking the amount alone marked the whole item
  // verified, so both clients showed "Whisky ×99" under a verified badge.
  const client = {
    complete: async () => ({
      items: [
        { name: "Whisky", quantity: 99, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } },
      ],
    }),
  };
  const result = await extract({ pages: [PAGE] }, client, new Date(2026, 7, 22));

  assert.equal(result.items[0]?.verified, false, "a fabricated name cannot ride a real amount");
  assert.equal(result.items[0]?.name, "Whisky", "kept and marked, never dropped");
  assert.deepEqual(result.unverified, ["items[0]"]);
});

test("a fabricated name alone is enough to make an item unverified", async () => {
  // Separate from the case above on purpose: there the invented quantity
  // would have failed the item anyway, so that test passed with the name
  // check deleted. This one carries no quantity, so only the name can fail it.
  const client = {
    complete: async () => ({
      items: [{ name: "Whisky", amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } }],
    }),
  };
  const result = await extract({ pages: [PAGE] }, client, new Date(2026, 7, 22));

  assert.equal(result.items[0]?.verified, false);
  assert.deepEqual(result.unverified, ["items[0]"]);
});

test("an item whose name and quantity the line does state is verified", async () => {
  // The guard above must not reject honest items: this row prints the name,
  // the quantity and the price, and all three are claimed as printed.
  const client = {
    complete: async () => ({
      items: [{ name: "커피", quantity: 1, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 1 4,500" } }],
    }),
  };
  const page = { text: "GS25\n커피 1 4,500\n합계 4,500\n", lines: [] };
  const result = await extract({ pages: [page] }, client, new Date(2026, 7, 22));

  assert.equal(result.items[0]?.verified, true);
  assert.deepEqual(result.unverified, []);
});

test("a quantity the cited line never printed makes the item unverified", async () => {
  // The realistic version of the finding above, and the reason the rule is
  // kept strict: `커피 4,500` states no count, so a helpful `quantity: 1` is
  // still a value with no evidence behind it.
  const client = {
    complete: async () => ({
      items: [{ name: "커피", quantity: 1, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } }],
    }),
  };
  const result = await extract({ pages: [PAGE] }, client, new Date(2026, 7, 22));

  assert.equal(result.items[0]?.verified, false);
  assert.equal(result.items[0]?.quantity, 1, "kept and marked, never dropped");
});

test("a multi-page scan is one document, so a header page cannot supply the total", async () => {
  // Reading page 0 alone was worse than incomplete: analyze's largest-amount
  // fallback fires on a page carrying no money, so a street number shipped as
  // paidTotal with verified: true, and currency came back KRW. The mobile app
  // scans with maxPages: 3, so this is its ordinary path.
  const client = { complete: async () => ({ items: [] }) };
  const result = await extract(
    {
      pages: [
        { text: "BLUE BOTTLE COFFEE\n123 MAIN ST\nSAN FRANCISCO CA\n", lines: [] },
        { text: "SANDWICH  12.99\nTAX  1.05\nTOTAL  $14.04\n", lines: [] },
      ],
    },
    client,
    new Date(2026, 7, 22),
  );

  assert.equal(result.fields.currency, "USD", "the money is on page 1, and so is the currency evidence");
  assert.equal(result.fields.paidTotal?.value, 1404);
  assert.equal(result.fields.paidTotal?.evidence.excerpt, "TOTAL  $14.04");
  assert.equal(result.fields.paidTotal?.evidence.pageIndex, 1, "evidence must name the page it is actually on");
});
