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

- **merchant** (5): KR-01 (`"ELEUE"`, the garbled brand mark), KR-03 (`"0|05 9 : (12)3456-7890"`, a registration/phone line), KR-04 (`"-1,167"`, an amount line that survives the merchant filter's `isAmountOnlyRow` check because it carries a leading minus sign the check doesn't strip), KR-06 (`"ЛЮТ9: 123-45-67890"`), EN-05 (`"not saleps"`).
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
`packages/contract/test/corpus.test.ts` marks these three receipts' item assertions `todo` (not silently weakened, not force-passed) pending a ruling on whether/how to tighten the shared predicate.

`items.ts`'s own header comment currently claims "The corpus proves this path derives nothing on all 12 real receipts" — that claim predates this task's corpus wiring and is now empirically false for 3 of the 12.
Left uncorrected pending the same ruling, since fixing the comment would look like ratifying a decision that hasn't been made yet.

## `columnAlignedValue` coverage (`total.ts`)

Instrumented directly (a temporary `console.error` inside the `values.length >= labels` branch, reverted after the run — `git diff` on `total.ts` is empty).
Across all 12 fixtures, `columnAlignedValue` never returned a non-null result: 0 hits.

The manifest's total-evidence notes for EN-01/EN-02/EN-03/EN-06 ("label and value occupy separate lines") describe the simpler single-label case that `splitTotalValueAfter`'s plain skip-ahead loop already handles, not the multi-label stacked-column case `columnAlignedValue` exists for (`SUBTOTAL:`/`TAX:`/`TOTAL:`/`VISA:` all consecutive, then all four values consecutive).
None of the 12 fixtures actually stacks 2+ label rows back to back before its values.
**This is a real coverage gap**: `columnAlignedValue`'s multi-row pairing branch has no fixture in this corpus exercising it and remains verified only by reading, as Task 5's review already flagged.

## Reproduction

Run `pnpm test` (53 tests, 50 pass, 0 fail, 3 `todo` — the items divergence above) for the pass/fail assertions.
The per-field counts above come from a one-off script that loads `analyze()` from `packages/contract/src/analyze.ts`, runs it over all 12 fixtures, and tallies non-null/matching values per field against `packages/contract/test/fixtures/receipts/expected.json`'s `ocrDerived` block; the script was not committed, but every number in it is reproducible from `corpus.test.ts`'s own per-receipt assertions.
