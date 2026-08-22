// Reproduces the per-field counts in docs/notes/corpus-baseline.md: runs
// analyze() over all 12 real corpus fixtures and tallies, per field, how
// many receipts got a derived (non-null) value versus how many of those
// values match the manifest's ocrDerived ground truth — plus the list of
// receipts where the parser returned a value the manifest marks
// derivable:false. Not part of pnpm test (root scripts/ isn't in its glob);
// run directly: `node scripts/measure-corpus.mjs`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../packages/contract/src/analyze.ts";

/** The parser builds its dates with `new Date(y, m - 1, d)` — LOCAL midnight —
 * so they must be read back with the local getters. `toISOString()` reinterprets
 * that instant as UTC and prints the previous calendar day in any positive-offset
 * zone: a 2026-07-02 receipt measured in Seoul reported 2026-07-01, which would
 * not match expected.json for a reader re-deriving this table. Same rule, and
 * same reason, as apps/web/src/extract.ts's toIsoDate. */
function isoDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(REPO_ROOT, "packages/contract/test/fixtures/receipts");
const REFERENCE = new Date(2026, 6, 20);
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "expected.json"), "utf8"));

const derivedCounts = { merchant: 0, purchaseDate: 0, paidTotal: 0, currency: 0, reference: 0 };
const matchCounts = { merchant: 0, purchaseDate: 0, paidTotal: 0, currency: 0, reference: 0 };
const nonDerivableButValued = { merchant: [], purchaseDate: [], paidTotal: [], reference: [], items: [] };
let itemsReceiptCount = 0;

function localDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

for (const receipt of manifest.receipts) {
  const rawText = fs.readFileSync(path.join(DIR, receipt.fixture), "utf8");
  const parsed = analyze(rawText, REFERENCE);
  const derived = receipt.ocrDerived;

  if (parsed.merchant !== null) {
    derivedCounts.merchant++;
    if (derived.merchant.derivable !== false && parsed.merchant.value === derived.merchant.value) {
      matchCounts.merchant++;
    }
    if (derived.merchant.derivable === false) {
      nonDerivableButValued.merchant.push({ id: receipt.id, value: parsed.merchant.value, evidence: parsed.merchant.evidence.text });
    }
  }

  if (parsed.purchaseDate !== null) {
    derivedCounts.purchaseDate++;
    if (derived.purchaseDate.derivable !== false) {
      const expect = localDate(derived.purchaseDate.value);
      if (parsed.purchaseDate.value.getTime() === expect.getTime()) matchCounts.purchaseDate++;
    }
    if (derived.purchaseDate.derivable === false) {
      nonDerivableButValued.purchaseDate.push({ id: receipt.id, value: isoDate(parsed.purchaseDate.value), evidence: parsed.purchaseDate.evidence.text });
    }
  }

  if (parsed.paidTotal !== null) {
    derivedCounts.paidTotal++;
    if (derived.paidTotalMinor.derivable !== false && parsed.paidTotal.value === derived.paidTotalMinor.value) {
      matchCounts.paidTotal++;
    }
    if (derived.paidTotalMinor.derivable === false) {
      nonDerivableButValued.paidTotal.push({ id: receipt.id, value: parsed.paidTotal.value, evidence: parsed.paidTotal.evidence.text });
    }
  }

  // currency is never a ParsedField — always present, so always "derived".
  derivedCounts.currency++;
  if (parsed.currency === derived.currency.value) matchCounts.currency++;

  if (parsed.reference !== null) {
    derivedCounts.reference++;
    if (derived.reference.derivable !== false && parsed.reference.value === derived.reference.value) {
      matchCounts.reference++;
    }
    if (derived.reference.derivable === false) {
      nonDerivableButValued.reference.push({ id: receipt.id, value: parsed.reference.value, evidence: parsed.reference.evidence.text });
    }
  }

  // items: the manifest marks all 12 derivable:false, so any non-empty
  // result is a divergence worth recording.
  if (parsed.items.length > 0) {
    itemsReceiptCount++;
    nonDerivableButValued.items.push({
      id: receipt.id,
      items: parsed.items.map((item) => ({ name: item.name, amountMinor: item.amountMinor, evidence: item.nameEvidence.text })),
    });
  }
}

console.log("=== derived (parser returned a non-null value / non-empty items), out of 12 ===");
console.log("merchant:", derivedCounts.merchant);
console.log("purchaseDate:", derivedCounts.purchaseDate);
console.log("paidTotalMinor:", derivedCounts.paidTotal);
console.log("currency:", derivedCounts.currency);
console.log("reference:", derivedCounts.reference);
console.log("items (receipts with >=1 item):", itemsReceiptCount);

console.log("\n=== matches manifest ocrDerived ground truth, out of 12 ===");
console.log("merchant:", matchCounts.merchant);
console.log("purchaseDate:", matchCounts.purchaseDate);
console.log("paidTotalMinor:", matchCounts.paidTotal);
console.log("currency:", matchCounts.currency);
console.log("reference:", matchCounts.reference);
console.log("items: n/a (manifest never gives item ground truth in ocrDerived)");

console.log("\n=== receipts where parser returned a value the manifest marks derivable:false ===");
for (const [field, list] of Object.entries(nonDerivableButValued)) {
  console.log(`-- ${field} --`);
  for (const entry of list) console.log(" ", JSON.stringify(entry));
}
