# Corpus baseline: what the parser actually derives

Measured against the 12-receipt anonymised corpus (`packages/contract/test/fixtures/receipts/`), copied read-only from `due_back/test/fixtures/receipts/`.
The manifest (`expected.json`) is ground truth for OCR-supportable facts (`ocrDerived`), not the top-level visual fields — those score a different, later extraction path.
This file counts what `analyze()` actually returns, not what the manifest's `derivable` flags claim it should.
The two numbers can differ, and where they differ is the interesting part.

## Per-field table

| Field           | Parser derived a value (of 12) | Matches manifest ground truth (of 12) |
| --------------- | ------------------------------- | -------------------------------------- |
| merchant        | 12                               | 7                                       |
| purchaseDate    | 11                               | 11                                      |
| paidTotalMinor  | 12                               | 7                                       |
| currency        | 12                               | 12                                      |
| reference       | 1                                | 1                                       |
| items           | 3 receipts return ≥1 item        | n/a — manifest never gives item ground truth in `ocrDerived` |

These "derived" and "match" numbers confirm the spec/README claims of currency 12/12, purchaseDate 11/12, merchant 7/12, paidTotalMinor 7/12, reference 1/12 exactly, on both axes.
**Items does not confirm the claimed 0/12.**
The parser returns a non-empty `items` array on 3 of the 12 receipts (see below) — the claimed 0/12 was read off the manifest's `derivable: false` flags, not off a run of the parser, and does not hold.
Reported as a finding, not silently corrected here.

## Receipts where the parser returned a value the manifest marks non-derivable

- **merchant** (5): KR-01 (`"ELEUE"`, the garbled brand mark), KR-03 (`"0|05 9 : (12)3456-7890"`, a registration/phone line), KR-04 (`"I21E"`, a garbled fragment two lines below the amount block — fixed to skip past the block itself, see below), KR-06 (`"ЛЮТ9: 123-45-67890"`), EN-05 (`"not saleps"`).
- **paidTotalMinor** (5): KR-02, KR-03, KR-05, KR-06, EN-05 — all via the `largestAmount` fallback (no `TOTAL_LABEL` row present), which picks up a barcode or approval-number digit run as the "largest amount" on the line.
- **purchaseDate** (0): none. KR-06 (the one manifest-non-derivable case) correctly returns `null`.
- **reference** (0): none.
- **items** (3): KR-02 (`"NO: 34567"` read as item `"NO:"` priced 34,567), KR-05 (`"X118/232 812"` → item `"X118/232"` priced 812), KR-06 (`"HE500* 100"` → item `"HE500*"` priced 100).

## Items: a real divergence, not a port bug

`extractItems`'s `isPricedItem`/`isPricedInCurrency` (`packages/contract/src/items.ts`) is a line-for-line port of `receipt_analyzer.dart:251-258` and `:285-289` — verified against the Dart source, not just read.
The Dart original has the same shape-matching behavior, so this is not a porting defect: on a garbled OCR line that happens to look like `<letters/symbols><whitespace><trailing digits>`, both implementations read it as an item name plus a price.
KRW's `isPricedInCurrency` is unconditionally `true` (won has no minor unit), so nothing in the currency check screens these out either.

`isPricedItem` is also read by `currency.ts`'s cents-row eligibility check (`_isAmountOnlyRow(text) || _isPricedItem(line)`, Dart `:400`), which feeds `inferCurrency` in `analyze.ts`.
Currency is currently 12/12 correct on this corpus, so narrowing `isPricedItem` to suppress these three false positives is not a safe unilateral change — it could move currency inference on receipts this baseline hasn't stress-tested.

**Ruling: keep the faithful port.** `packages/contract/test/corpus.test.ts` now pins the exact wrong output for these three receipts (KR-02 → item `"NO:"` at 34,567; KR-05 → `"X118/232"` at 812; KR-06 → `"HE500*"` at 100) as real, passing assertions, not `todo`s. A known-wrong, faithfully-ported behavior is honest to assert; the pin exists so a future narrowing of the shared predicate shows up as a failing test here rather than a silent behavior change.

`items.ts`'s own header comment previously claimed "The corpus proves this path derives nothing on all 12 real receipts" — false for 3 of the 12.
Corrected to state the measured truth: no *correct* item on any of the 12, and a spurious one on 3, citing this file.

## Merchant: KR-04's negative-amount blind spot (fixed)

KR-04's merchant filter (`analyze.ts`) was returning `"-1,167"` — a negative amount line — because `isAmountOnlyRow` doesn't strip a leading sign before checking whether a line is nothing but an amount.
That is correct behavior for `isAmountOnlyRow`'s other callers (`total.ts`, `currency.ts`, both measured correct on this corpus), so the fix lives locally in the merchant filter instead: a leading `+`/`-` is stripped before delegating to `isAmountOnlyRow`.
This is within the merchant filter's own stated rule ("skip a line only when it parses as a date or is nothing but an amount") — a negative amount is still an amount.
Pinned by `analyze.test.ts`'s `"analyze skips a negative amount line when looking for the merchant"`, which failed before the fix and passes after it.
KR-04's merchant now resolves to `"I21E"` (still wrong — the manifest's reason is "the rotated scan starts with amount lines; the brand mark appears sixteen lines later" — but no longer an amount masquerading as a name).

## Non-derivable fields are pinned by exact value, not "quotes a line"

A reviewer proved the original non-derivable check ("if the parser returned a value, its evidence must quote a real recognised line") cannot fail: reverting the KR-04 merchant sign fix above and rerunning `corpus.test.ts` produced zero failures, because any line the parser happens to pick satisfies "is a real line."
A gate that cannot fail is exactly what this repository argues against.

`corpus.test.ts` now pins the exact current value and evidence text for every `derivable: false` field the parser nonetheless populates: the five merchants (KR-01, KR-03, KR-04, KR-06, EN-05) and the five paid totals (KR-02, KR-03, KR-05, KR-06, EN-05), the same style already used for the three spurious items above.
These pinned values are wrong on purpose — the manifest says so — and the assertion exists so any future change to the parser's output on these fields shows up as a failing test instead of passing silently.

Verified directly: reverting the KR-04 fix and running `node --test packages/contract/test/corpus.test.ts` now fails (KR-04's merchant pin expects `"I21E"`, gets `"-1,167"`); restoring the fix passes again.
`purchaseDate` and `reference` keep the weaker "quotes a line" check because the parser currently returns `null` for every `derivable: false` case in both fields on this corpus (0/12) — there is no wrong value to pin yet.

## `columnAlignedValue` coverage (`total.ts`)

Instrumented directly (a temporary `console.error` inside the `values.length >= labels` branch, reverted after the run — `git diff` on `total.ts` is empty).
Across all 12 fixtures, `columnAlignedValue` never returned a non-null result: 0 hits.

The manifest's total-evidence notes for EN-01/EN-02/EN-03/EN-06 ("label and value occupy separate lines") describe the simpler single-label case that `splitTotalValueAfter`'s plain skip-ahead loop already handles, not the multi-label stacked-column case `columnAlignedValue` exists for (`SUBTOTAL:`/`TAX:`/`TOTAL:`/`VISA:` all consecutive, then all four values consecutive).
None of the 12 fixtures actually stacks 2+ label rows back to back before its values.
This was a real coverage gap: `columnAlignedValue`'s multi-row pairing branch had no fixture in this corpus exercising it and was verified only by reading, as Task 5's review flagged.
Closed by a dedicated unit test in `packages/contract/test/total.test.ts` (`"selectTotal pairs stacked labels with their column-aligned values"`), a synthetic `SUBTOTAL:`/`TAX:`/`TOTAL:` block that exercises the branch directly rather than relying on a real fixture that happens to shape it that way.

## Reproduction

Run `pnpm test` (55 tests, 55 pass, 0 fail, 0 todo) for the pass/fail assertions.
Run `node scripts/measure-corpus.mjs` to re-derive the per-field counts above: it loads `analyze()` from `packages/contract/src/analyze.ts`, runs it over all 12 fixtures, and tallies non-null/matching values per field against `packages/contract/test/fixtures/receipts/expected.json`'s `ocrDerived` block, plus the full list of receipts where a value was returned against a `derivable: false` fact.
