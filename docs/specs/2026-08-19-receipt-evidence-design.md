# receipt-evidence — Design

Status: approved 2026-08-19.
A React Native app and a TypeScript backend that turn a scanned receipt into structured data **that can show its work**: every extracted value carries the line of source text it came from, and a deterministic parser — not another model — decides whether the model earned its answer.

## Why this exists

Receipt extraction is the canonical LLM demo, and almost every version of it asks the reader to trust the output.
This one answers two questions the usual demo leaves open.

1. **Does the model actually need to be here?**
   Measured by running the parser over 12 real receipts, not asserted (`docs/notes/corpus-baseline.md`).
   It gets currency right 12/12 and the purchase date 11/12.
   Then it gets interesting: it returns a merchant on **all 12** but only **7** are right, and a paid total on **all 12** of which again only **7** are right — the rest are a garbled brand mark, a registration number, or a barcode run picked up by the largest-amount fallback.
   Line items are worse than absent: on 3 of the 12 it **invents** one, reading `NO: 34567` as an item named `NO:` priced 34,567.

   So the honest finding is not "a parser cannot do items". It is that a deterministic parser's failure mode is the same as a language model's — confident wrongness, with no signal attached telling you which half you are looking at.
   That is the case for this project's whole shape: evidence on every value, arithmetic recomputed independently, and anything unsupported marked rather than presented.
2. **What happens when the model is wrong?**
   Every value must quote a source excerpt; deterministic code then checks the excerpt exists in the OCR text, checks the value appears inside the excerpt, and recomputes the arithmetic itself.
   A value that cannot show its evidence is surfaced as unverified rather than presented as fact.

## Scope

**In:** camera and gallery capture on iOS and Android, on-device OCR, deterministic extraction, an LLM pass for what the parser cannot derive, evidence verification, arithmetic re-checking, a mobile result surface with image evidence, and a web demo that draws image evidence when OCR-line geometry is supplied.

**Out:** persistence, accounts, authentication, multi-user, expense categorisation, receipt storage, and anything that outlives a single request.
The server holds nothing after it answers.

## Architecture

A single pnpm workspace:

```plaintext
apps/mobile/        Expo (dev client) — capture via react-native-receipt-scanner
apps/web/           Next.js — /api/extract Route Handler + one demo page
packages/contract/  shared types, the model's JSON schema, the parser, the guards, their tests
docs/{specs,plans,notes}
```

`packages/contract` is the centre of gravity.
It holds the parser, the guards, and the types, so the server, the demo page, and the app all see one definition of what a receipt fact is and one implementation of whether a fact is trustworthy.
Its tests need no network and no device.

### The pipeline

1. **Capture (app).** `scan()` returns `ReceiptImage { uri, width, height, ocrText, ocrLines[{ text, frame }], ocrQuality }`.
   `ocrLines` carries a bounding box per line, which is what makes evidence visible rather than merely quotable.
2. **Floor decision (app).** The app keeps every scanner page, then evaluates its `ocrQuality` against `DEFAULT_OCR_FLOOR` itself.
   Pages that clear it are sent as text; only a page below the floor also uploads its JPEG.
   One round trip, and the image leaves the device only when the text cannot carry the work.
3. **Deterministic pass (server).** The parser extracts merchant, date, total, currency, and reference from the OCR text, each with the line it came from.
4. **Model pass (server).** The model is asked only for what the parser did not derive — always the line items, plus whichever header fields came back empty.
   The JSON schema makes `evidence: { pageIndex, excerpt }` required on every value; a response without it is invalid, not merely suspect.
   A line item carries TWO of them — `nameEvidence` and `amountEvidence` — because OCR can flatten an item table into columns (issue #3), printing an item's name and its amount many lines apart; a receipt that prints them together cites the same line twice.
5. **Verification (server, deterministic).**
   - The excerpt must occur in that page's OCR text, compared after NFKC normalisation, within a run of at most four ADJACENT lines.
     One line was the original rule, and real captures broke it: a Korean receipt can print an item's name, barcode, quantity, and price on separate lines. The cap and the adjacency requirement are what keep the relaxation from letting a model quote the page whole.
   - The value must occur inside the excerpt, and how that is asked depends on the value's type: an amount against the line's amounts read the parser's own way (`excerptContainsAmount`), a string as a normalised substring (`excerptContainsText`), a date by re-parsing the cited line and comparing the calendar day.
     This was originally specified as one ported rule, `excerptContainsValue` from catfood-feeder. That port was removed on 2026-08-22 (see `packages/contract/src/guards.ts` for the two measured failures): it compared minor units against the printed decimal, so every honest USD amount failed, and it demanded exactly one numeric token, which no ordinary receipt row satisfies.
     Strings and dates, meanwhile, had never been checked at all — a fabricated merchant quoting any real line was published as `verified: true`.
   - Split item evidence is additionally bound by order: printing preserves row order, so items citing split evidence must agree on it between their name positions and their amount positions — compared as page, then line, then offset within the line.
     One printed token cannot back two items' halves however each quoted it, an excerpt the page cannot place unambiguously demotes its item (for a split item the position is the binding), and two distinct excerpts on one OCR-merged line remain two claims.
     A crossed pairing is demoted to unverified even though its sum still adds up — the permutation is invisible to the arithmetic check, which is exactly why ordering has to carry the binding.
   - The parser re-parses the model's evidence line on its own — even for a field it could not derive from the whole document, it can usually read one cited line — and if it reads a different value there than the model claimed, both readings are reported as a disagreement.
   - Line-item amounts are summed and compared against the paid total.

   **One rule for failure, everywhere:** a value that fails any check is kept, marked `verified: false`, and listed under `unverified`.
   It is never silently dropped and never presented as fact.
   Dropping it would hide the interesting half of the demo; presenting it would be the exact failure this project exists to prevent.
6. **Anchoring (server).** Each surviving excerpt is matched back to `ocrLines` to recover its bounding box.
7. **Presentation (app and web).** The mobile app receives `ocrLines` from its scanner and draws a box over each anchored field. The web demo accepts separately supplied OCR-line geometry and draws boxes only when that geometry is present. Both surfaces mark unverified values and show arithmetic mismatches rather than silently correcting them.

### Response shape

```json
{
  "fields": { "merchant": { "value": "7-Eleven", "source": "model", "evidence": { "pageIndex": 0, "excerpt": "...", "box": { "x": 0, "y": 0, "width": 0, "height": 0 } }, "verified": true } },
  "items": [
    {
      "name": "디아)기네스드래프트440ml",
      "quantity": 4,
      "amountMinor": 13000,
      "source": "model",
      "nameEvidence": { "pageIndex": 0, "excerpt": "디아)기네스드래프트440ml", "box": { "x": 0, "y": 0, "width": 0, "height": 0 } },
      "amountEvidence": { "pageIndex": 0, "excerpt": "13,000", "box": { "x": 0, "y": 0, "width": 0, "height": 0 } },
      "verified": true
    }
  ],
  "tenders": [{ "value": 5000, "source": "parser", "evidence": { "pageIndex": 0, "excerpt": "상품권결제금액: 5,000", "box": { "x": 0, "y": 0, "width": 0, "height": 0 } }, "verified": true }],
  "arithmetic": { "itemSumMinor": 13000, "claimedTotalMinor": 8000, "reconciledTenderMinor": 5000, "agrees": true },
  "unverified": [],
  "disagreements": []
}
```

`source` is `parser` or `model` on every field, so a reader can see which half of the system produced each value.

## Salvage from due_back

`due_back` is a stopped Flutter project, but two of its parts are the most expensive pieces of this design and both are finished and tested.
Its 52 tests pass as of 2026-08-19.

- **`ReceiptAnalyzer` (523 lines of Dart)** — a deterministic parser whose comments record real edge cases: Korean and English date forms, expiry-label exclusion, discount and subtotal rows that are not the paid total, count rows that are not money (`TOTAL NUMBER OF ITEMS SOLD - 10`), non-merchandise rows (`CHANGE DUE`, `거스름`, `승인`), currency inference that reads `12,900원` as money and `원두커피` as coffee, and clock times stripped before amount inference.
  It already carries an evidence model: every fact quotes its `OcrEvidence { lineIndex, text }`.
- **A 12-receipt corpus** (6 Korean, 6 English) of anonymised OCR text with a manifest of expected facts, per-fact evidence lines, and — for each fact the OCR cannot support — a written reason why.

Both are copied, not moved; `due_back` is left alone.
Same author, both MIT.

The port is mechanical (regular expressions and string handling), and the Dart tests port with it as the acceptance criterion: the TypeScript parser must reproduce the same 12-receipt manifest.

**Assumption to check during implementation:** the corpus was recognised by `due_back`'s own capture path, not by `react-native-receipt-scanner`.
Both sit on ML Kit and Vision, so the text should be comparable, but the first device run will show whether the fixtures match what this app actually receives.

## Testing

- **Corpus golden tests** — the ported parser against the 12-receipt manifest, no network.
- **Guard tests** — a fabricated model response whose value never appears in the OCR text must be rejected. Deleting the guard must break this test; that is how the guard is known to be load-bearing.
- **Arithmetic tests** — item sums that agree, disagree, and cannot be computed at all.
- **Schema/type test** — the JSON schema handed to the model and the TypeScript types stay in step.
- **One device pass** — camera and gallery on a real iPhone, because a screenshot of a simulator proves nothing about VisionKit.

## Risks

- **Model identifier.** The API model name is confirmed against OpenAI's current documentation before any call is written; it is not written from memory.
- **Korean OCR quality.** The corpus shows how badly item names survive recognition. If the model cannot recover items from barcode-and-amount fragments either, that is a finding worth publishing rather than a failure to hide — and the image-fallback path exists for exactly this case.
- **Cost per request.** Text-only requests dominate; images travel only below the OCR floor.

## Open decisions

None blocking. The repository is `receipt-evidence`, public, MIT.
