# receipt-evidence

Scan a receipt, get structured data that can show its work.

Every extracted value quotes the line of recognised text it came from, and a deterministic parser — not a second model — decides whether the model earned its answer.
A value that cannot show its evidence is kept and reported as unverified, never dropped and never presented as fact.

## Why a model is here at all

A deterministic parser was ported first, then measured against 12 real anonymised receipts (6 Korean, 6 English) before any model was involved.
Re-derive this table any time with `node scripts/measure-corpus.mjs`; the long form is in [`docs/notes/corpus-baseline.md`](docs/notes/corpus-baseline.md).

| Field        | Parser returned a value | …and it was right  |
| ------------ | ----------------------- | ------------------ |
| currency     | 12 / 12                 | 12 / 12            |
| purchaseDate | 11 / 12                 | 11 / 12            |
| merchant     | 12 / 12                 | 7 / 12             |
| paidTotal    | 12 / 12                 | 7 / 12             |
| reference    | 1 / 12                  | 1 / 12             |
| line items   | 3 / 12 returned one     | **0 / 12 correct** |

Two readings, and the second one is the point.

Currency and date are solved: a model asked for them would be a cost with no upside, so the pipeline never asks.
Line items are where the parser has nothing — and worse, on 3 receipts it _invents_ one, reading a barcode fragment like `HE500* 100` as an item named `HE500*` priced at 100.
Merchant and paid total look complete and are wrong 5 times each, returning a garbled brand mark, or a barcode run picked up by the largest-amount fallback.

That last row is why this repository exists.
**A deterministic parser fails the same way a model does: confidently, with no signal attached.**
"Rule-based, therefore trustworthy" does not survive contact with real OCR.
So the answer is not to prefer one source over the other — it is to make every value, from either source, carry the line it was read from, and to check that line independently before calling it verified.

## How a value earns `verified: true`

1. **The parser goes first.** Whatever it derives is the baseline, and the model is never asked for it.
2. **The model is asked only for the gaps** — line items, plus any header field the parser left blank — and must quote a verbatim page excerpt for every value it reports.
3. **Deterministic code checks the reply.** The excerpt must appear on one real line of the page (`verifyEvidence`), and the value must actually be stated in that excerpt — an amount checked against the line's amounts as the parser itself reads them, a string as text, a date by re-parsing the line and comparing the day. Then the parser re-reads the cited line on its own and reports any disagreement, whatever the guard decided.
4. **The items are re-added independently** and compared with the claimed total. `agrees: null` is a third state — nothing to compare — and is shown as itself rather than folded into a failure.
5. **Anything that fails is kept**, marked `verified: false`, and listed in `unverified`. Dropping it would hide the interesting half.

Both guards fail closed on an empty excerpt, because every string contains `""` — without that check the guard would verify everything.
That one shipped here, and is now pinned by a test.

## Quick start

Requires Node 24+ and pnpm 11.

```bash
pnpm install
pnpm test        # no network, no device
pnpm typecheck   # the only type gate — node strips types, it does not check them
```

The demo page takes pasted OCR text (and optionally a receipt photo) and renders the result with its evidence.
Set `OPENAI_API_KEY` in the web app's local environment file, then:

```bash
pnpm --filter web dev            # http://localhost:3000
```

## The mobile app

`apps/mobile` is the capture path: the platform document scanner, on-device OCR, one request, and evidence boxes drawn on the photo.

**Expo Go cannot load it.**
`react-native-receipt-scanner` is a native module, so the app needs a dev client:

```bash
pnpm --filter @receipt-evidence/mobile prebuild
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3000 pnpm --filter @receipt-evidence/mobile ios
```

`ios/` and `android/` are generated rather than committed, so `prebuild` is the first step on a fresh clone.
The API URL has to be a LAN address: a phone's `localhost` is the phone.

A page is sent as text alone when its OCR clears the scanner's floor; only a page below the floor also uploads its JPEG, so the image leaves the device exactly when the text cannot carry the work.

## Layout

```log
packages/contract/   the parser, the guards, the schema, the response types — shared by every client
apps/web/            POST /api/extract and the demo page
apps/mobile/         the Expo app
docs/                the design spec, the plan, and the measured baseline
scripts/             measure-corpus.mjs, which re-derives the table above
```

`packages/contract/src/{evidence,dates,amounts,total,currency,items,analyze}.ts` are a statement-by-statement port of a Dart receipt parser from a stopped project, kept honest by that project's own 12-receipt corpus — including the receipts it gets wrong, which are pinned by exact value so a change in behaviour fails loudly rather than passing silently.

There is no test framework, deliberately: Node runs TypeScript directly, so `node --test` is the whole harness.

## License

MIT — see [LICENSE](LICENSE).
