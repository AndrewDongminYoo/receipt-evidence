# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `docs/specs/2026-08-19-receipt-evidence-design.md` for why this exists and what the pipeline is, `docs/notes/corpus-baseline.md` for the measured numbers the README quotes, and `docs/plans/2026-08-19-receipt-evidence.md` for the task-by-task build.
This file covers what those do not, or what will bite before you get to them.

## Commands

```bash
pnpm test                                   # node --test over packages/*/test and apps/*/test
pnpm typecheck                              # tsc over the workspace, then apps/mobile's own tsconfig
pnpm --filter web dev                       # the demo page + /api/extract
pnpm --filter @receipt-evidence/mobile prebuild   # generate ios/ + android/ (not committed)
node --test packages/contract/test/guards.test.ts          # one file
node --test --test-name-pattern '<substring>' <file>       # one test
node scripts/measure-corpus.mjs             # re-derive the per-field baseline table
```

There is **no test framework**, deliberately. Node runs `.ts` directly by stripping types, so tests import `../src/x.ts` with the extension. Adding vitest or jest is a plan violation, not a preference.

Node strips types rather than checking them, so `pnpm test` says nothing about type errors — `pnpm typecheck` is the only type gate, and it has `strict`, `noUnusedLocals` and `noUnusedParameters` on.

## What the system does

A receipt's OCR text goes through a deterministic parser first; a model is asked only for what the parser could not derive; then deterministic code checks everything the model said.

`packages/contract` is the centre of gravity — the parser, the guards, the schema, and the types all live there so the server, the demo page and the mobile app share one definition of what a receipt fact is. Its tests need no network and no device.

`apps/web/src/extract.ts` is the pipeline. `apps/web/src/model-client.ts` is the only place that talks to OpenAI, and `extract()` takes the client as a parameter so tests substitute a fake — **no test in this repository makes a network call.**

`apps/mobile` is checked by its own `tsconfig.json` (React Native needs Expo's compiler settings), which the root `typecheck` script runs after the workspace one; `tsconfig.base.json` excludes it. Its testable logic lives in `src/capture.ts`, which imports the scanner for *types only* so `node --test` never loads React Native.

## Invariants that will bite

- **A value that fails a check is kept, marked `verified: false`, and listed in `unverified`.** Never dropped, never presented as fact. Dropping it hides the interesting half; presenting it is the failure this project exists to prevent. The same rule is why `arithmetic.agrees` has a third state: `null` means "nothing to compare", which is not `false`.
- **Evidence is one line.** `verifyEvidence` (guards) and `anchorToLines` (anchor) answer the same question and share `normalize.ts` so they cannot drift — a value that verified but could not be anchored would be unshowable. Both fail closed on an empty excerpt: every string contains `""`, so without that check the guard verifies everything.
- **Two guards per value, and the second one is type-specific.** `verifyEvidence` asks whether the excerpt is a real line; then `excerptContainsAmount` (amounts, read through the parser's own `amountsOnLine` so guard and parser cannot disagree), `excerptContainsText` (strings), or a `parseDate` round-trip (dates) asks whether the value is actually stated there. Never run only the first: for four months the string and date paths did exactly that, and a fabricated merchant quoting any real line shipped as `verified: true`. Parser-derived fields run the same guards as model-derived ones — there is no exempt source.
- **`packages/contract/test/fixtures/receipts/expected.json` is ground truth and is never edited to match the parser.** It is byte-identical to its source in `due_back`. If the parser disagrees, either the port has a bug or the manifest is genuinely wrong — and the second one needs a human, not a commit.
- **Money is integer minor units** (`amountMinor`) — KRW whole won, USD cents. Never a float.
- **Dates are read back with local getters, never `toISOString()`.** The parser builds `new Date(y, m-1, d)` — local midnight — so `toISOString().slice(0,10)` reports the previous day in any positive-offset zone. That bug shipped once here, marked `verified: true`, on every Korean receipt.
- **The OpenAI model identifier is never written from memory.** It lives in `docs/notes/model-identifier.md` with the URL and date it was read from.
- Versions are pinned, not floated: `zod@4.4.3`, `openai@7.5.0`, `next@16.3.1`, `react@19.2.8` (web), `expo@57.0.14`, `react-native@0.86.2` + `react@19.2.3` (mobile).
  The mobile pair comes from `expo@57.0.14`'s `bundledNativeModules.json`, not from npm's `latest` — Expo's prebuild and autolinking are coupled to the version the SDK was built against. `pnpm peers check` reports one unmet peer for this (`react-dom@19.2.8` wants `^19.2.8`, sees mobile's 19.2.3); each app still links its own react, verified through `apps/*/node_modules/react`.

## The parser is a port, and the port is the point

`packages/contract/src/{evidence,dates,amounts,total,currency,items,analyze}.ts` are ported from `due_back/lib/due_back/service/receipt_analyzer.dart` — read-only, never modify it. Every ported file names its Dart source path and line range in a header comment.

The comments carry real edge cases (`TOTAL NUMBER OF ITEMS SOLD - 10` is not a total, `12,900원` is money but `원두커피` is coffee, a clock time is not an amount). Port statement by statement; do not paraphrase a condition into something that merely passes the listed tests.

Two deliberate deviations from the Dart, both documented at their site: the merchant skips lines that parse as an amount or a date (Dart takes `lines.first`, which publishes an amount as the merchant name on one corpus receipt), and Dart's `confidence` score is not ported — this system reports verification instead.

## Before trusting a test

Nine defects on this project were tests or gates that passed while proving nothing — a corpus gate that could not fail, a "pin" whose inputs missed the branch it named, a schema assertion that held with or without the setting it claimed to check. When you add a guard or a gate, break the thing it protects and watch it fail before you believe it.

## Current state

Every task in the plan is implemented: the parser and its corpus gate, the guards, arithmetic, anchoring, the schema, `/api/extract`, the demo page, the image fallback, the Expo app, and the README and CI. 87 tests pass and both typechecks exit 0.

**One step is outstanding and it needs a human: Task 16 Step 4, the device pass.** The app has never been run — no `expo prebuild`, no native build, no camera or gallery capture on a real phone. It installs on the operator's daily iPhone, so it is theirs to authorise.

The branch `feat/scaffold-parser-and-extraction` has never been pushed; only `main` exists on the remote.
