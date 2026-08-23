# receipt-evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan a receipt and return structured data where every value quotes the source line it came from, a deterministic parser verifies the model's answers, and anything that cannot show its evidence is reported as unverified.

**Architecture:** One pnpm workspace. `packages/contract` owns the parser, the guards, the schema, and the types, and its tests run without network or device. `apps/web` exposes `/api/extract` plus a demo page; `apps/mobile` captures through `react-native-receipt-scanner` and draws evidence boxes over the receipt.

**Tech Stack:** TypeScript, Node's built-in test runner (`node --test`, native type stripping — no test framework dependency), pnpm workspaces, zod 4.4.3 for the one schema definition, openai 7.5.0, Next.js 16.3.1 + React 19.2.8, Expo 57.0.14 + React Native 0.86.2 + React 19.2.3, `react-native-receipt-scanner` 0.8.0.

**Spec:** `docs/specs/2026-08-19-receipt-evidence-design.md`

## Global Constraints

- **Versions** verified against the npm registry on 2026-08-19: `expo@57.0.14`, `next@16.3.1`, `react@19.2.8`, `openai@7.5.0`, `zod@4.4.3`. Pin these; do not float.
- **The mobile pins are Expo's, not npm's `latest`** (corrected 2026-08-22 at Task 16). This line originally read `react-native@0.87.0`, which is what npm ships as `latest` — but `expo@57.0.14`'s own `bundledNativeModules.json` names `react-native` `0.86.2` and `react` `19.2.3`, and Expo's prebuild and autolinking are coupled to that pair. The app uses Expo's versions; the web app keeps `react@19.2.8` for Next 16.3.1, which pnpm resolves per workspace package. `expo` and `expo-file-system` were then raised again to `57.0.15`/`57.0.5` by `expo run:ios` on 2026-08-23 — the CLI aligns the manifest during prebuild — and those are the versions the first successful native build used.
- **No test framework.** Tests are `node --test` over `*.test.ts`. Node strips TypeScript types natively. Adding vitest or jest to `packages/contract` is a plan violation.
- **The OpenAI model identifier is never written from memory.** Task 14 begins by reading OpenAI's current model documentation and recording the identifier in the plan's own notes file. A model id that appears in code without that step is a defect.
- **One failure rule, everywhere:** a value that fails any check is kept, marked `verified: false`, and listed under `unverified`. Never silently dropped, never presented as fact.
- **Money is integer minor units.** `amountMinor`, never a float. KRW has no minor unit in practice, so KRW minor units are whole won; USD minor units are cents. This mirrors `paidTotalMinor` in the corpus manifest.
- **Ported code carries its origin.** Every file ported from `due_back` names the Dart source path in a header comment. Both projects are MIT and same-author; the comment is provenance, not licensing.
- **Source of the port:** `/Volumes/dongminyu/Development/01_personal/due_back`. Read-only. Never modify it.

---

## File Structure

```plaintext
package.json                       workspace root, pnpm workspaces, scripts
pnpm-workspace.yaml
tsconfig.base.json
packages/contract/
  src/evidence.ts                  OcrEvidence type + evidenceLines()
  src/dates.ts                     parseDate()
  src/amounts.ts                   parseAmountMinor(), amount eligibility
  src/total.ts                     selectTotal()
  src/currency.ts                  inferCurrency()
  src/items.ts                     extractItems()
  src/analyze.ts                   analyze() — assembles a ParsedReceipt
  src/guards.ts                    excerptContainsAmount(), excerptContainsText(), verifyEvidence()
  src/arithmetic.ts                checkArithmetic()
  src/anchor.ts                    anchorToLines()
  src/schema.ts                    zod schema for the model's reply + JSON Schema
  src/types.ts                     ExtractionResponse and friends
  test/fixtures/receipts/          12 .txt files + expected.json (copied)
  test/*.test.ts                   one file per src module
apps/web/
  app/api/extract/route.ts         the endpoint
  app/page.tsx                     demo page: upload, result, evidence overlay
  src/model-client.ts              OpenAI call, isolated behind an interface
apps/mobile/
  App.tsx                          scan -> POST -> render
  src/EvidenceOverlay.tsx          boxes drawn over the receipt image
docs/notes/model-identifier.md     written by Task 14 from official docs
```

---

### Task 1: Workspace skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/contract/package.json`, `packages/contract/tsconfig.json`, `packages/contract/src/types.ts`, `packages/contract/test/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm test` at the root runs `node --test` over `packages/contract/test/**/*.test.ts`. The `Money` type: `type Money = { amountMinor: number; currency: "KRW" | "USD" }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/types.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { isMoney } from "../src/types.ts";

test("isMoney accepts integer minor units and rejects floats", () => {
  assert.equal(isMoney({ amountMinor: 14800, currency: "KRW" }), true);
  assert.equal(isMoney({ amountMinor: 148.5, currency: "USD" }), false);
  assert.equal(isMoney({ amountMinor: 100, currency: "EUR" }), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../src/types.ts'`.

- [ ] **Step 3: Write the workspace files**

```json
// package.json
{
  "name": "receipt-evidence",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test 'packages/*/test/**/*.test.ts'",
    "typecheck": "tsc --noEmit -p tsconfig.base.json"
  },
  "devDependencies": { "typescript": "^6.0.3", "@types/node": "^26.2.0" },
  "packageManager": "pnpm@11.20.0"
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
  - "apps/*"
```

```ts
// packages/contract/src/types.ts
/** Currencies the corpus actually contains. Widen only with a fixture to prove it. */
export type Currency = "KRW" | "USD";

/** Money is always integer minor units — KRW won, USD cents. Never a float. */
export interface Money {
  amountMinor: number;
  currency: Currency;
}

export function isMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Money>;
  return (
    Number.isInteger(candidate.amountMinor) &&
    (candidate.currency === "KRW" || candidate.currency === "USD")
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build: 🏗️ set up the pnpm workspace and the contract package"
```

---

### Task 2: Evidence lines

**Files:**
- Create: `packages/contract/src/evidence.ts`, `packages/contract/test/evidence.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface OcrEvidence { lineIndex: number; text: string }` and `evidenceLines(rawText: string): OcrEvidence[]`. Every later module quotes lines through this type.

Port from `due_back/lib/due_back/service/receipt_analyzer.dart:176-184`. Blank lines are trimmed away **first**, and `lineIndex` is then assigned over what survives — Dart's `.indexed` runs on the already-filtered iterable. So the index counts recognised lines, not raw document lines. That is also what the rest of the system needs: the index points into the scanner's `ocrLines[]`, which contains recognised lines only and never blanks.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/evidence.test.ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/contract/src/evidence.ts
// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:176-184.

/** One recognised line, and where it sat in the original OCR text. */
export interface OcrEvidence {
  lineIndex: number;
  text: string;
}

export function evidenceLines(rawText: string): OcrEvidence[] {
  return rawText
    .split("\n")
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    // The index is assigned after filtering, matching Dart's `.indexed` on the
    // filtered iterable: it counts recognised lines, which is what the scanner's
    // ocrLines[] is indexed by too.
    .map((text, lineIndex) => ({ lineIndex, text }));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/evidence.ts packages/contract/test/evidence.test.ts
git commit -m "feat(contract): ✨ split OCR text into indexed evidence lines"
```

---

### Task 3: Dates

**Files:**
- Create: `packages/contract/src/dates.ts`, `packages/contract/test/dates.test.ts`

**Interfaces:**
- Consumes: `OcrEvidence` from Task 2.
- Produces: `parseDate(text: string): Date | null` and `selectDate(lines: OcrEvidence[], referenceDate: Date): OcrEvidence | null`.

Port from `receipt_analyzer.dart:9-13` (`_datePattern`), `:14-17` (`_expiryLabel`), and the date branch of `analyze()` at `:97-104`. Two rules travel with it: a line matching the expiry label is never the purchase date, and a date **after** the reference date belongs to an expiry, a return window, or a misread year — a purchase already happened.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/dates.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { parseDate, selectDate } from "../src/dates.ts";

test("parseDate reads Korean, dotted, and slashed forms", () => {
  assert.deepEqual(parseDate("2026년 7월 1일"), new Date(2026, 6, 1));
  assert.deepEqual(parseDate("2026.07.29 18:42"), new Date(2026, 6, 29));
  assert.deepEqual(parseDate("07/29/2026"), new Date(2026, 6, 29));
});

test("parseDate rejects a calendar-invalid date", () => {
  assert.equal(parseDate("2026-02-31"), null);
});

test("parseDate ignores a short date embedded in a longer identifier", () => {
  assert.equal(parseDate("78901234567890123456"), null);
});

test("parseDate skips a calendar-invalid match and takes the valid one beside it", () => {
  assert.deepEqual(parseDate("2026-02-31 승인 2026-07-01"), new Date(2026, 6, 1));
});

test("selectDate skips expiry labels and future dates", () => {
  const reference = new Date(2026, 6, 20);
  const lines = evidenceLines("유효기간 2027-01-01\n2028-05-05\n2026-07-02 20:20:50\n");

  assert.equal(selectDate(lines, reference)?.text, "2026-07-02 20:20:50");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Translate the Dart regular expressions literally. Dart's `caseSensitive: false` becomes the `i` flag; the lookbehinds `(?<!\d)` work unchanged in V8.

```ts
// packages/contract/src/dates.ts
// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:9-17, 97-104.
import type { OcrEvidence } from "./evidence.ts";

const DATE_PATTERN_G =
  /(\d{4})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})일?|(?<!\d)(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?!\d)|(?<!\d)(\d{1,2})[-/](\d{1,2})[-/](\d{2})(?!\d)/g;
const EXPIRY_LABEL = /(expir|\bexp\b|유효기간)/i;

/** Rejects a date the calendar does not have — 2026-02-31 round-trips wrong. */
function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? date : null;
}

function dateFromMatch(match: RegExpMatchArray): Date | null {
  if (match[1]) return calendarDate(+match[1], +match[2], +match[3]);
  if (match[6]) return calendarDate(+match[6], +match[4], +match[5]);
  // A two-digit year is this century; receipts from 1926 are not in scope.
  return calendarDate(2000 + +match[9], +match[7], +match[8]);
}

export function parseDate(text: string): Date | null {
  // Every match on the line, not just the first: an OCR-mangled date sitting
  // before a real one must not blind the parser to the real one. Dart does the
  // same at receipt_analyzer.dart:482-488.
  for (const match of text.matchAll(DATE_PATTERN_G)) {
    const date = dateFromMatch(match);
    if (date !== null) return date;
  }
  return null;
}

export function selectDate(lines: OcrEvidence[], referenceDate: Date): OcrEvidence | null {
  return (
    lines.find((line) => {
      const date = parseDate(line.text);
      // A purchase already happened, so a later date belongs to an expiry, a
      // return window, or a misread year rather than to this receipt.
      return date !== null && !EXPIRY_LABEL.test(line.text) && date <= referenceDate;
    }) ?? null
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS. If the embedded-identifier case fails, the lookbehind is missing from the third alternative — compare against the Dart source rather than loosening the test.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/dates.ts packages/contract/test/dates.test.ts
git commit -m "feat(contract): ✨ parse receipt dates and reject expiries"
```

---

### Task 4: Amounts

**Files:**
- Create: `packages/contract/src/amounts.ts`, `packages/contract/test/amounts.test.ts`

**Interfaces:**
- Consumes: `OcrEvidence`.
- Produces: `parseAmountMinor(text: string, currency: Currency): number | null` and `canUseAsAmount(line: OcrEvidence): boolean`.

Port from `receipt_analyzer.dart:59-87` (`_trailingAmount`, `_amountPattern`, `_centsAmount`, `_clockTime`, `_splitGrouping`, `_maxWholeDigits`), `:192-197` (`amountFrom`, `canUseAsAmount` — thin wrappers), and **`:441-470`, where the actual work lives** (`_amountOf`, `_minorUnits`, `_withoutDateOrTime`). Note that `_amountOf` keeps the LAST amount on the line, not the first: `TOTAL 2 ITEMS $24.95` is 2495, not 2. Three rules matter: a clock time is stripped before amounts are read, an OCR-split thousands separator (`13, 364`) is rejoined, and a digit run longer than 15 is an identifier rather than money.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/amounts.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { canUseAsAmount, parseAmountMinor } from "../src/amounts.ts";

test("parseAmountMinor reads won as whole units and dollars as cents", () => {
  assert.equal(parseAmountMinor("₩14,800", "KRW"), 14800);
  assert.equal(parseAmountMinor("TOTAL $24.95", "USD"), 2495);
});

test("parseAmountMinor rejoins a thousands separator split by OCR", () => {
  assert.equal(parseAmountMinor("13, 364", "KRW"), 13364);
});

test("parseAmountMinor keeps a clock time out of the amount", () => {
  assert.equal(parseAmountMinor("2026.07.02 20:20:50", "KRW"), null);
});

test("parseAmountMinor rejects digit runs too long to be money", () => {
  assert.equal(parseAmountMinor("78901234567890123456", "KRW"), null);
});

test("canUseAsAmount rejects a line that is only a date", () => {
  assert.equal(canUseAsAmount({ lineIndex: 0, text: "2026-07-01" }), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Port the constants verbatim, then the two functions. Keep the Dart comments — they are the reason each rule exists.

```ts
// packages/contract/src/amounts.ts
// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:59-87, 192-244.
import type { Currency } from "./types.ts";
import type { OcrEvidence } from "./evidence.ts";

const TRAILING_AMOUNT = /\s+(?:(?:KRW|USD)\s*)?[₩$]?\s*(\d[\d,]*(?:\.\d{2})?)원?\s*$/i;
const AMOUNT_PATTERN = /\d[\d,]*(?:\.\d{2})?/;
// Clock times ride the same line as dates on receipts; a colon never appears
// in an amount, so stripping `14:30:22` keeps it out of amount inference.
const CLOCK_TIME = /\d{1,2}:\d{2}(?::\d{2})?/g;
const SPLIT_GROUPING = /(\d),\s+(?=\d)/g;
const MAX_WHOLE_DIGITS = 15;
```

The remaining body — `parseAmountMinor`, `canUseAsAmount`, and the date-exclusion they share — is a direct translation of the Dart at `:192-244`. Read that range and port it statement by statement; do not paraphrase the conditions.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, all five amount tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/amounts.ts packages/contract/test/amounts.test.ts
git commit -m "feat(contract): ✨ read receipt amounts as integer minor units"
```

---

### Task 5: Total selection

**Files:**
- Create: `packages/contract/src/total.ts`, `packages/contract/test/total.test.ts`

**Interfaces:**
- Consumes: `OcrEvidence`, `parseAmountMinor`, `canUseAsAmount`.
- Produces: `selectTotal(lines: OcrEvidence[], currency: Currency): OcrEvidence | null`.

Port from `receipt_analyzer.dart:18-37` (`_totalLabel`, `_otherAmountLabel`, `_countLabel`) and the `_totalEvidenceOf` helper. When no labelled total exists the largest eligible amount wins, and a total printed on the line after its label is picked up by a two-line lookahead (`_splitTotalLookahead = 2`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/total.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { selectTotal } from "../src/total.ts";

test("selectTotal ignores discount, subtotal and tax rows", () => {
  const lines = evidenceLines("소계 20,000\n할인금액 -6,600\n합계 14,800\n");

  assert.equal(selectTotal(lines, "KRW")?.text, "합계 14,800");
});

test("selectTotal keeps a paid total that also reports an item count", () => {
  const lines = evidenceLines("TOTAL 2 ITEMS $24.95\n");

  assert.equal(selectTotal(lines, "USD")?.text, "TOTAL 2 ITEMS $24.95");
});

test("selectTotal rejects a count row carrying no money", () => {
  const lines = evidenceLines("TOTAL NUMBER OF ITEMS SOLD - 10\n");

  assert.equal(selectTotal(lines, "USD"), null);
});

test("selectTotal yields no evidence for a labelled fare row", () => {
  // The no-label fallback accepts a row that is a currency-marked amount and
  // NOTHING else, which is how `SUBTOTAL $20.00`, `TENDER $20.00` and
  // `TAX $1.05` stay out (receipt_analyzer.dart:338-341). A fare row has the
  // same shape, so it is excluded too and the receipt gets a total with no
  // evidence line. That "TAXI" is not read as a tax row is a currency-inference
  // claim, and Task 6 pins it.
  const lines = evidenceLines("TAXI FARE $12.99\n");

  assert.equal(selectTotal(lines, "USD"), null);
});

test("selectTotal pairs a total printed on the following line", () => {
  const lines = evidenceLines("TOTAL\n189,000\n");

  assert.equal(selectTotal(lines, "KRW")?.text, "189,000");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/contract/src/total.ts
// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:18-37 and _totalEvidenceOf.
const TOTAL_LABEL = /(^|\s)(total|grand total|결제금액|합계)(\s|:|$)/i;
// A row naming a different money figure is never the paid total. The English
// labels match as whole words, so `TAXI FARE $12.99` is a fare rather than a
// tax row; the Korean ones match anywhere, because `할인금액` is one word.
const OTHER_AMOUNT_LABEL = /\b(discount|saved|savings?|tax|vat|subtotal)\b|소계|할인|세금|부가세/i;
// A row naming a count is the paid total only when it also carries money:
// `TOTAL 2 ITEMS $24.95` is a total, `TOTAL NUMBER OF ITEMS SOLD - 10` is a tally.
const COUNT_LABEL = /\b(count|number|items?|sold|qty|quantity)\b|수량|개수/i;
const SPLIT_TOTAL_LOOKAHEAD = 2;
```

Port `_totalEvidenceOf` from the Dart source beneath these constants, then the largest-amount fallback.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, all five total tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/total.ts packages/contract/test/total.test.ts
git commit -m "feat(contract): ✨ pick the paid total apart from discounts and counts"
```

---

### Task 6: Currency inference

**Files:**
- Create: `packages/contract/src/currency.ts`, `packages/contract/test/currency.test.ts`

**Interfaces:**
- Consumes: `OcrEvidence`.
- Produces: `inferCurrency(rawText: string, lines: OcrEvidence[], total: OcrEvidence | null): Currency`.

Port from `receipt_analyzer.dart:68-80` and `_currencyFrom`. The rule worth keeping intact: `원` is a currency only where it follows an amount — `12,900원` is money, `원두커피` is coffee.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/currency.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { inferCurrency } from "../src/currency.ts";

test("inferCurrency reads 원 as currency only after an amount", () => {
  const money = evidenceLines("합계 12,900원\n");
  const coffee = evidenceLines("원두커피 $4.50\n");

  assert.equal(inferCurrency("합계 12,900원", money, money[0]), "KRW");
  assert.equal(inferCurrency("원두커피 $4.50", coffee, coffee[0]), "USD");
});

test("inferCurrency reads a fare row as USD — TAXI is not a tax row", () => {
  // receipt_analyzer_test.dart:611-620 asserts exactly this and nothing else:
  // `\btax\b` matches as a whole word, so TAXI never triggers the tax label.
  const lines = evidenceLines("City Cabs\nTAXI FARE $12.99\n");

  assert.equal(inferCurrency("City Cabs\nTAXI FARE $12.99", lines, null), "USD");
});

test("inferCurrency keeps a dotted date out of cents detection", () => {
  const lines = evidenceLines("GS25\n2026.07.02 20:20:50\n17,100\n");

  assert.equal(inferCurrency("GS25\n2026.07.02 20:20:50\n17,100", lines, lines[2]), "KRW");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/contract/src/currency.ts
// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:68-80, _currencyFrom.
// `원` is a currency only where it follows an amount: `12,900원` is money,
// `원두커피` is coffee.
const WON_MARKER = /₩|\bKRW\b|\d\s*원/i;
const DOLLAR_MARKER = /(\$|USD)/i;
const CENTS_AMOUNT = /\d\.\d{2}(?!\d)/;
```

Port `_currencyFrom` beneath these. Strip clock times before testing `CENTS_AMOUNT`, or `20:20:50` reads as cents.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, both currency tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/currency.ts packages/contract/test/currency.test.ts
git commit -m "feat(contract): ✨ infer the receipt currency from its markers"
```

---

### Task 7: Items

**Files:**
- Create: `packages/contract/src/items.ts`, `packages/contract/test/items.test.ts`

**Interfaces:**
- Consumes: `OcrEvidence`, `parseAmountMinor`.
- Produces: `interface ParsedItem { name: string; amountMinor: number; nameEvidence: OcrEvidence; amountEvidence: OcrEvidence }` and `extractItems(lines: OcrEvidence[], currency: Currency): ParsedItem[]`.

Port from `receipt_analyzer.dart:38-58` (`_nonMerchandiseLabel`, `_nonItemLabel`, `_namedItem`) and the `itemCandidates` block at `:116-135`.

The corpus proves this path derives **nothing** on all 12 real receipts — item names do not survive recognition. That is expected and is the reason the model exists in this system. Build it anyway: it is what verifies the model's items later, and it works on the cleaner synthetic receipts below.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/items.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { extractItems } from "../src/items.ts";

test("extractItems reads priced items with their evidence lines", () => {
  const lines = evidenceLines(
    "Mono Market\nNoise cancelling headphones 149,000\nProtective case 40,000\n2026-07-30\nTotal 189,000\n",
  );

  const items = extractItems(lines, "KRW");

  assert.equal(items.length, 2);
  assert.equal(items[0].name, "Noise cancelling headphones");
  assert.equal(items[0].amountMinor, 149000);
  assert.equal(items[0].nameEvidence.lineIndex, 1);
  assert.equal(items[1].amountEvidence.text, "Protective case 40,000");
});

test("extractItems excludes settlement and column-header rows", () => {
  const lines = evidenceLines("OIL CHANGE 39.99\nCHANGE DUE 7.01\nQTY 1.00\n거스름 500\n");

  assert.deepEqual(
    extractItems(lines, "USD").map((item) => item.name),
    ["OIL CHANGE"],
  );
});

test("extractItems needs a name, not only punctuation", () => {
  const lines = evidenceLines("2@ 2.05\n$ 41.00\n");

  assert.deepEqual(extractItems(lines, "USD"), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/contract/src/items.ts
// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:38-58, 116-135.
// Settlement and column-header rows print a price like an item does, so they
// are matched at the start of the line where such a label always sits:
// `OIL CHANGE 39.99` is merchandise, `CHANGE DUE 7.01` and `QTY 1.00` are not.
const NON_MERCHANDISE_LABEL =
  /^((tender|change|balance|due|amount|payment|paid|auth|approval|cash|visa|mastercard|debit|credit|qty|quantity)\b|현금|수량|개수|거스름|잔액|받은\s*금액|승인)/i;
const NON_ITEM_LABEL =
  /(total|subtotal|discount|tax|vat|card|cash|visa|mastercard|합계|결제금액|소계|할인|세금|카드|현금)/i;
// An item needs a name, and `2@ 2.05` or `$ 41.00` leaves only punctuation
// once its trailing price is removed.
const NAMED_ITEM = /[A-Za-zㄱ-힝]/;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, all three item tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/items.ts packages/contract/test/items.test.ts
git commit -m "feat(contract): ✨ extract priced line items with their evidence"
```

---

### Task 8: Assemble the parser

**Files:**
- Create: `packages/contract/src/analyze.ts`, `packages/contract/test/analyze.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-7.
- Produces:

```ts
export interface ParsedField<T> { value: T; evidence: OcrEvidence }
export interface ParsedReceipt {
  merchant: ParsedField<string> | null;
  purchaseDate: ParsedField<Date> | null;
  paidTotal: ParsedField<number> | null;   // minor units
  currency: Currency;
  reference: ParsedField<string> | null;
  items: ParsedItem[];
  lines: OcrEvidence[];
}
export function analyze(rawText: string, referenceDate: Date): ParsedReceipt;
```

Every field is null when the parser cannot derive it. Null is the signal that hands that field to the model in Task 14 — it is load-bearing, not a placeholder.

Port merchant and reference selection from `receipt_analyzer.dart:38-41` (`_referenceLabel`), `:106-111`, and `:247-...` (`referenceFrom`). The merchant is the first line that is neither an amount nor a date.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/analyze.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { analyze } from "../src/analyze.ts";

const REFERENCE = new Date(2026, 6, 30);

test("analyze fills every field from a clean receipt", () => {
  const parsed = analyze(
    "Mono Market\nNoise cancelling headphones 149,000\nProtective case 40,000\n2026-07-30\nTotal 189,000\nOrder DB-240730\n",
    REFERENCE,
  );

  assert.equal(parsed.merchant?.value, "Mono Market");
  assert.equal(parsed.paidTotal?.value, 189000);
  assert.equal(parsed.currency, "KRW");
  assert.deepEqual(parsed.purchaseDate?.value, new Date(2026, 6, 30));
  assert.equal(parsed.reference?.value, "DB-240730");
  assert.equal(parsed.items.length, 2);
});

test("analyze leaves a field null rather than guessing it", () => {
  const parsed = analyze("Corner Shop\nPortable SSD\n89,000\nCard 1234\n", REFERENCE);

  assert.equal(parsed.reference, null);
  assert.equal(parsed.paidTotal?.value, 89000);
});

test("analyze quotes evidence that re-parses to the same value", () => {
  const parsed = analyze("GS25\n2026.07.02 20:20:50\n17,100\n", REFERENCE);

  assert.equal(parsed.paidTotal?.evidence.text, "17,100");
  assert.deepEqual(parsed.purchaseDate?.value, new Date(2026, 6, 2));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `analyze()` by composing Tasks 2-7**

Follow the order in `receipt_analyzer.dart:89-175`: lines, date, total, reference, amount, currency, items, merchant. Do not invent a confidence score — `due_back` had one for its own UI and this system reports verification instead.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, all three assembly tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/analyze.ts packages/contract/test/analyze.test.ts
git commit -m "feat(contract): ✨ assemble the deterministic receipt parser"
```

---

### Task 9: The corpus gate

**Files:**
- Copy: `due_back/test/fixtures/receipts/*` → `packages/contract/test/fixtures/receipts/` (12 `.txt` files plus `expected.json`)
- Create: `packages/contract/test/corpus.test.ts`, `docs/notes/corpus-baseline.md`

**Interfaces:**
- Consumes: `analyze()`.
- Produces: the measured baseline this project's argument rests on.

The manifest marks each fact `derivable: true` with a value and evidence, or `derivable: false` with a written reason. The test asserts **both directions**: a derivable fact must be extracted exactly, and a non-derivable fact must **not** be invented.

- [ ] **Step 1: Copy the fixtures**

```bash
mkdir -p packages/contract/test/fixtures/receipts
cp /Volumes/dongminyu/Development/01_personal/due_back/test/fixtures/receipts/* \
   packages/contract/test/fixtures/receipts/
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/contract/test/corpus.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { analyze } from "../src/analyze.ts";

const DIR = path.join(import.meta.dirname, "fixtures", "receipts");
const REFERENCE = new Date(2026, 6, 20);
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "expected.json"), "utf8"));

for (const receipt of manifest.receipts) {
  test(`${receipt.id} extracts only OCR-supported facts`, () => {
    const rawText = fs.readFileSync(path.join(DIR, receipt.fixture), "utf8");
    const parsed = analyze(rawText, REFERENCE);
    const derived = receipt.ocrDerived;

    if (derived.paidTotalMinor.derivable === false) {
      assert.equal(parsed.paidTotal, null, `${receipt.id} must not invent a total`);
    } else {
      assert.equal(parsed.paidTotal?.value, derived.paidTotalMinor.value, receipt.id);
      assert.equal(parsed.paidTotal?.evidence.text, derived.paidTotalMinor.evidence, receipt.id);
    }

    if (derived.merchant.derivable === false) {
      assert.equal(parsed.merchant, null, `${receipt.id} must not invent a merchant`);
    } else {
      assert.equal(parsed.merchant?.value, derived.merchant.value, receipt.id);
    }

    assert.equal(parsed.currency, derived.currency.value, receipt.id);
    // Items are derivable on none of the twelve; that gap is the model's job.
    if (derived.items.derivable === false) {
      assert.deepEqual(parsed.items, [], `${receipt.id} must not invent items`);
    }
  });
}
```

- [ ] **Step 3: Run it and watch it fail, then port until it passes**

Run: `pnpm test`
Expected at first: failures on some receipts. Fix by comparing against the Dart implementation for that rule — never by relaxing the manifest. The manifest is the ground truth; changing it to match a bug is the one unacceptable move in this task.

- [ ] **Step 4: Record the baseline**

Write `docs/notes/corpus-baseline.md` with the per-field counts a real run produces, on BOTH axes: how often the parser returned a value, and how often that value matched the manifest. Measured 2026-08-19: currency 12/12 correct, purchaseDate 11/12, merchant returned 12 and correct 7, paidTotalMinor returned 12 and correct 7, reference 1/12, and items returned on 3 receipts — all three spurious. The earlier "items 0/12" claim counted manifest flags rather than parser output and did not survive measurement.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/test/fixtures packages/contract/test/corpus.test.ts docs/notes/corpus-baseline.md
git commit -m "test(contract): ✅ gate the parser on the 12-receipt corpus"
```

---

### Task 10: Evidence guards

**Files:**
- Create: `packages/contract/src/guards.ts`, `packages/contract/test/guards.test.ts`

**Interfaces:**
- Consumes: `OcrEvidence`.
- Produces:

```ts
export function excerptContainsValue(excerpt: string, value: number): boolean;
export function verifyEvidence(excerpt: string, pageText: string): boolean;
```

**Superseded 2026-08-22 — the port below was built as written, then removed.** A review probe ran the pipeline instead of reading it and found the ported rule could not do this job: it compared minor units against the excerpt's printed decimal (`excerptContainsValue("SANDWICH  12.99", 1299) === false`, so every honest USD amount was flagged, and half this corpus is English), and it required exactly one numeric token, which an ordinary row printing a quantity beside a price never satisfies. The same probe found strings and dates were never value-checked at all. `guards.ts` now exports `excerptContainsAmount` (reads a line with the parser's own `amountsOnLine`) and `excerptContainsText`, and `extract()` checks a date by re-parsing its cited line. The task text below is left as it was written, as the record of what was built.

Port `excerptContainsValue` from `catfood-feeder/src/lib/source-extraction.ts:288-328`; its helpers `normalizeDecimalLiteral` and `DECIMAL_COMMA` live in a different file, `catfood-feeder/src/lib/excerpt-match.ts:6,12-31`, and are imported from there. It normalises NFKC, rejects the fraction slash, finds the first numeric token, handles decimal-comma forms, and checks the token's leading boundary.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/guards.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { excerptContainsValue, verifyEvidence } from "../src/guards.ts";

test("excerptContainsValue accepts a value that occurs in its excerpt", () => {
  assert.equal(excerptContainsValue("합계 14,800", 14800), true);
  assert.equal(excerptContainsValue("TOTAL $24.95", 2495), false); // minor units are the caller's job
});

test("excerptContainsValue rejects a value the excerpt never states", () => {
  assert.equal(excerptContainsValue("합계 14,800", 13000), false);
});

test("verifyEvidence rejects an excerpt absent from the page text", () => {
  const page = "GS25\n합계 14,800\n";

  assert.equal(verifyEvidence("합계 14,800", page), true);
  assert.equal(verifyEvidence("합계 99,999", page), false);
});

test("verifyEvidence compares after NFKC normalisation", () => {
  assert.equal(verifyEvidence("１４，８００", "합계 14,800"), true);
});

test("a real excerpt carrying a value it never states is rejected", () => {
  // The subtler hallucination, and the one catfood-feeder's guard was built for:
  // the model quotes a line that genuinely exists and attaches a number that is
  // not in it. verifyEvidence passes here — only excerptContainsValue catches it.
  const page = "GS25\n합계 14,800\n";

  assert.equal(verifyEvidence("합계 14,800", page), true);
  assert.equal(excerptContainsValue("합계 14,800", 13000), false);
});

test("a fabricated model value cannot pass the guard", () => {
  // The regression that gives this whole project its point: delete either guard
  // and this test must fail.
  const page = "GS25\n합계 14,800\n";
  const fabricated = { value: 148000, excerpt: "합계 148,000" };

  assert.equal(
    verifyEvidence(fabricated.excerpt, page) && excerptContainsValue(fabricated.excerpt, fabricated.value),
    false,
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement by porting from catfood-feeder**

Read `/Volumes/dongminyu/Development/01_personal/catfood-feeder/src/lib/source-extraction.ts:292-358` and port `excerptContainsValue` and `normalizeDecimalLiteral`. `verifyEvidence` is new and small: NFKC-normalise both sides, collapse runs of whitespace, then substring-test.

- [ ] **Step 4: Run it and watch it pass, then prove the guard is load-bearing**

Run: `pnpm test`
Expected: PASS.
Then comment out the body of `verifyEvidence` so it returns `true`, re-run, and confirm the fabricated-value test **fails**. Restore it. A guard whose removal breaks nothing is decoration.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/guards.ts packages/contract/test/guards.test.ts
git commit -m "feat(contract): ✨ verify model values against their evidence"
```

---

### Task 11: Arithmetic re-check

**Files:**
- Create: `packages/contract/src/arithmetic.ts`, `packages/contract/test/arithmetic.test.ts`

**Interfaces:**
- Consumes: `ParsedItem`.
- Produces: `checkArithmetic(items: { amountMinor: number }[], claimedTotalMinor: number | null): { itemSumMinor: number | null; claimedTotalMinor: number | null; agrees: boolean | null }`.

`agrees` is `null` when either side is missing — an unanswerable question is not an agreement.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/arithmetic.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { checkArithmetic } from "../src/arithmetic.ts";

test("checkArithmetic agrees when the items sum to the total", () => {
  const result = checkArithmetic([{ amountMinor: 13000 }, { amountMinor: 1700 }, { amountMinor: 100 }], 14800);

  assert.deepEqual(result, { itemSumMinor: 14800, claimedTotalMinor: 14800, agrees: true });
});

test("checkArithmetic reports a mismatch without correcting it", () => {
  const result = checkArithmetic([{ amountMinor: 13000 }], 14800);

  assert.deepEqual(result, { itemSumMinor: 13000, claimedTotalMinor: 14800, agrees: false });
});

test("checkArithmetic answers null when either side is missing", () => {
  assert.equal(checkArithmetic([], 14800).agrees, null);
  assert.equal(checkArithmetic([{ amountMinor: 100 }], null).agrees, null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/contract/src/arithmetic.ts
export interface ArithmeticCheck {
  itemSumMinor: number | null;
  claimedTotalMinor: number | null;
  /** null when the question cannot be asked — an absent answer is not agreement. */
  agrees: boolean | null;
}

export function checkArithmetic(
  items: readonly { amountMinor: number }[],
  claimedTotalMinor: number | null,
): ArithmeticCheck {
  const itemSumMinor = items.length > 0 ? items.reduce((sum, item) => sum + item.amountMinor, 0) : null;
  const agrees =
    itemSumMinor === null || claimedTotalMinor === null ? null : itemSumMinor === claimedTotalMinor;
  return { itemSumMinor, claimedTotalMinor, agrees };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, all three arithmetic tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/arithmetic.ts packages/contract/test/arithmetic.test.ts
git commit -m "feat(contract): ✨ recompute the item sum against the claimed total"
```

---

### Task 12: Anchoring evidence to boxes

**Files:**
- Create: `packages/contract/src/anchor.ts`, `packages/contract/test/anchor.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except types.
- Produces:

```ts
export interface OcrLine { text: string; frame: { x: number; y: number; width: number; height: number } }
export function anchorToLines(excerpt: string, lines: readonly OcrLine[]): OcrLine["frame"] | null;
```

`OcrLine` mirrors the shape `react-native-receipt-scanner` returns, so the app can pass its `ocrLines` straight through.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/anchor.test.ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Normalise both sides the same way `verifyEvidence` does, then return the frame of the first line that contains the excerpt. A missing box is `null`; the field is still returned, just without a highlight.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, all three anchor tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/anchor.ts packages/contract/test/anchor.test.ts
git commit -m "feat(contract): ✨ anchor an evidence excerpt to its OCR box"
```

---

### Task 13: The model's schema

**Files:**
- Create: `packages/contract/src/schema.ts`, `packages/contract/test/schema.test.ts`
- Modify: `packages/contract/package.json` (add `zod@4.4.3`)

**Interfaces:**
- Consumes: nothing. In particular NOT `Currency` — `inferCurrency` always returns a concrete value, so currency is never a field the parser leaves empty and the model is never asked for it. An earlier version of this line said otherwise and produced a schema branch that could not fire.
- Produces: `ModelReplySchema` (zod), `type ModelReply = z.infer<typeof ModelReplySchema>`, and `modelJsonSchema()` returning the JSON Schema the API is handed.

One definition produces the runtime validator, the TypeScript type, and the JSON Schema. Writing the JSON Schema by hand alongside the type is the drift this task exists to prevent.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/test/schema.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { ModelReplySchema, modelJsonSchema } from "../src/schema.ts";

test("the schema requires evidence on every value", () => {
  const withoutEvidence = { items: [{ name: "커피", quantity: 1, amountMinor: 4500 }] };

  assert.equal(ModelReplySchema.safeParse(withoutEvidence).success, false);
});

test("the schema accepts a fully evidenced reply", () => {
  const reply = {
    items: [
      { name: "커피", quantity: 1, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } },
    ],
    merchant: { value: "GS25", evidence: { pageIndex: 0, excerpt: "GS25" } },
  };

  assert.equal(ModelReplySchema.safeParse(reply).success, true);
});

test("a reply carrying an invented field is rejected, not silently stripped", () => {
  // zod emits `additionalProperties: false` from toJSONSchema even without
  // .strict(), so asserting the emitted schema pins nothing about the runtime
  // choice. This exercises it. `confidence` is the fixture on purpose: it is
  // what a model volunteers, and this project refuses to carry one.
  const reply = {
    items: [
      { name: "커피", quantity: 1, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } },
    ],
    confidence: 0.91,
  };

  assert.equal(ModelReplySchema.safeParse(reply).success, false);
});

test("the JSON schema handed to the model matches the zod definition", () => {
  const jsonSchema = modelJsonSchema();

  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties.items, "items must be present in the JSON schema");
  assert.equal(jsonSchema.additionalProperties, false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement with zod, deriving the JSON Schema rather than writing it**

zod 4 exposes JSON Schema conversion in core; use it rather than hand-writing a second definition. Set `additionalProperties: false` so a reply carrying invented fields is rejected structurally.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, all three schema tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/schema.ts packages/contract/test/schema.test.ts packages/contract/package.json pnpm-lock.yaml
git commit -m "feat(contract): ✨ define the model reply schema once, in zod"
```

---

### Task 14: The extraction endpoint

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`
- Create: `apps/web/src/model-client.ts`, `apps/web/app/api/extract/route.ts`
- Create: `apps/web/test/extract.test.ts`, `docs/notes/model-identifier.md`

**Interfaces:**
- Consumes: `analyze`, `verifyEvidence`, `excerptContainsValue`, `checkArithmetic`, `anchorToLines`, `ModelReplySchema`.
- Produces: `POST /api/extract` taking `{ pages: [{ text, lines, imageBase64? }] }` and returning the `ExtractionResponse` from the spec. `ModelClient` is an interface with one method, so tests substitute a fake and never call OpenAI.

- [ ] **Step 1: Record the model identifier from official documentation**

Read OpenAI's current model documentation and write `docs/notes/model-identifier.md` with the exact identifier, the date read, and the source URL. Do not write a model name from memory into code. If the documentation cannot be reached, stop and report it rather than guessing.

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/test/extract.test.ts
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
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `extract()` and the route that wraps it**

`extract()` holds the pipeline and takes the client as a parameter — that is what keeps it testable. The route reads the request, builds the real client from `process.env.OPENAI_API_KEY`, and returns `extract()`'s result. The key is read server-side only and never returned in any response.

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm test`
Expected: PASS, all three extraction tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web docs/notes/model-identifier.md pnpm-lock.yaml
git commit -m "feat(web): ✨ extract a receipt through the parser, the model, and the guards"
```

---

### Task 14b: The image fallback

**Files:**
- Modify: `apps/web/src/model-client.ts`, `apps/web/src/extract.ts`
- Test: `apps/web/test/model-client.test.ts`

**Interfaces:**
- Consumes: `Page.imageBase64` — already declared and already sent by the demo page.
- Produces: a request that carries the page's image when one is present, and does not when it is not.

Added after Task 15 found that `imageBase64` was declared, populated by the caller, and read by nothing. The spec's pipeline has the app attach a JPEG only for a page below the OCR floor; the client must therefore transmit it when present. Without this the floor decision is decoration and the spec describes a path the code does not have.

The test uses a fake client and asserts both directions: a page carrying `imageBase64` produces a request containing the image, and a page without one produces a request that does not. Assert on what the client sends, not on what a model replies — no test in this repository makes a network call.

---

### Task 15: The demo page

**Files:**
- Create: `apps/web/app/page.tsx`, `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `POST /api/extract`.
- Produces: the page a reviewer opens without building anything.

It accepts a receipt image, runs OCR-free (the page has no scanner — it posts the image and lets the server's image path handle it), and renders fields, items, evidence boxes over the image, unverified values marked, and the arithmetic verdict shown whether it agrees or not.

- [ ] **Step 1: Build the page and verify it by hand**

There is no automated test for this page; its job is to be looked at. Run `pnpm --filter web dev`, upload `packages/contract/test/fixtures/receipts/kr_01.txt`'s source image if available or any receipt photo, and confirm: fields render, at least one evidence box lands on the right line, an unverified value is visibly marked, and a mismatch shows as a mismatch.

- [ ] **Step 2: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): ✨ show extraction results with their evidence"
```

---

### Task 16: The mobile app

**Files:**
- Create: `apps/mobile/` (Expo app), `apps/mobile/App.tsx`, `apps/mobile/src/EvidenceOverlay.tsx`

**Interfaces:**
- Consumes: `react-native-receipt-scanner@0.8.0`'s `scan()` and `DEFAULT_OCR_FLOOR`; `POST /api/extract`.
- Produces: the capture path the sample is actually about.

- [ ] **Step 1: Create the Expo app and add the scanner**

```bash
pnpm create expo-app apps/mobile --template blank-typescript
pnpm --filter mobile add react-native-receipt-scanner@0.8.0
pnpm --filter mobile exec expo prebuild
```

Expo Go cannot load this module. Record that in the README along with `npx expo run:ios`.

- [ ] **Step 2: Wire scan → floor → POST**

`scan()` returns pages with `ocrText`, `ocrLines`, and `ocrQuality`. Send every page's text; attach the JPEG only for a page below `DEFAULT_OCR_FLOOR`. One request.

- [ ] **Step 3: Draw the evidence overlay**

`ocrLines[].frame` is in the image's pixel coordinate space, and `ReceiptImage` carries `width`/`height` — scale by the rendered size rather than assuming a fixed ratio.

- [ ] **Step 4: Device pass**

Run on a real iPhone: camera path and gallery path, one receipt each. A simulator cannot exercise VisionKit's document scanner. Announce the install before running it — the device is the operator's daily phone.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): ✨ scan a receipt and show its evidence on the image"
```

---

### Task 17: README and publication

**Files:**
- Modify: `README.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: everything.
- Produces: what a reviewer reads first.

- [ ] **Step 1: Write the README around the measured baseline**

Lead with the number from `docs/notes/corpus-baseline.md`: the deterministic parser derives currency on 12/12 and items on 0/12, which is why the model is here. Then quick start (under ten minutes), the Expo Go caveat, and what the guards do. Link the live demo.

- [ ] **Step 2: Add CI**

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm typecheck
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

```bash
git add README.md .github
git commit -m "docs: 📝 lead the README with the measured parser baseline"
```

---

## Self-Review

**Spec coverage.** Capture (T16), floor decision (T16), deterministic pass (T2-T9), model pass (T13-T14), verification including the parser re-reading the model's cited line (T10, T14), arithmetic (T11), anchoring (T12), presentation (T15, T16), the one failure rule (T10, T14), salvage from due_back (T2-T9 port, T9 corpus), the testing section (T9, T10, T11, T13, T16 device pass), the model-identifier risk (T14 Step 1).

**Gap found and closed:** the spec's disagreement check — the parser re-parsing the model's evidence line — is asserted in T14's tests but has no dedicated module. It belongs inside `extract()` using `analyze()` on a single line; T14 Step 4 covers it. If a future reviewer wants it isolated, that is a refactor, not a missing task.

**Placeholders:** none. Every code step carries the code; the port tasks name exact Dart source ranges rather than saying "port the parser".

**Type consistency:** `OcrEvidence` (T2) is used unchanged through T8. `ParsedItem` (T7) feeds `checkArithmetic` (T11) via its structural `{ amountMinor }` requirement. `OcrLine` (T12) matches the scanner's shape consumed in T16. `Money`/`Currency` (T1) flows through T4, T5, T6, T8.
