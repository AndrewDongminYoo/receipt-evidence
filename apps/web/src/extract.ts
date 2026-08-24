// The extraction pipeline: parser first, model for whatever the parser could
// not derive, then the guards from packages/contract decide what gets to
// claim `verified: true`. Takes the model client as a parameter (Task 14
// brief) so tests substitute a fake and never call OpenAI.
import { analyze } from "@receipt-evidence/contract/analyze";
import { evidenceLines } from "@receipt-evidence/contract/evidence";
import type { ParsedField, ParsedReceipt } from "@receipt-evidence/contract/analyze";
import { verifyEvidence, excerptContainsAmount, excerptContainsText } from "@receipt-evidence/contract/guards";
import { parseDate } from "@receipt-evidence/contract/dates";
import { checkArithmetic } from "@receipt-evidence/contract/arithmetic";
import { anchorToLines } from "@receipt-evidence/contract/anchor";
import { ModelReplySchema } from "@receipt-evidence/contract/schema";
import type { ModelReply } from "@receipt-evidence/contract/schema";
import type { ModelClient } from "./model-client.ts";

import type {
  Disagreement,
  ExtractedField,
  FieldSource,
  ExtractedItem,
  ExtractionResponse,
  Frame,
  Page,
} from "@receipt-evidence/contract/response";

export type {
  Disagreement,
  EvidenceRef,
  ExtractedField,
  ExtractedItem,
  ExtractionResponse,
  FieldSource,
  Frame,
  Page,
} from "@receipt-evidence/contract/response";

function box(pages: readonly Page[], pageIndex: number, excerpt: string): Frame | null {
  return anchorToLines(excerpt, pages[pageIndex]?.lines ?? []);
}

function pageText(pages: readonly Page[], pageIndex: number): string {
  return pages[pageIndex]?.text ?? "";
}

/** Re-runs the deterministic parser on just the cited excerpt, as if it were
 * the whole document — the same `analyze()` Task 8 already exports, no
 * excerpt-specific module needed. A one-line excerpt rarely carries a TOTAL
 * label, so `paidTotal` here is usually `analyze`'s own largest-amount
 * fallback; that is still an independent second reading of the same text. */
function reparseAmount(excerpt: string, referenceDate: Date): number | null {
  return analyze(excerpt, referenceDate).paidTotal?.value ?? null;
}

export function toIsoDate(date: Date): string {
  // dates.ts builds this Date with `new Date(year, month - 1, day)` — LOCAL
  // midnight — so it must be read back through the LOCAL getters, not
  // toISOString(): that reinterprets the instant as UTC and shifts the
  // calendar day in any non-zero offset zone (a receipt read in Korea,
  // UTC+9, would report the day before it was bought). Read the same way
  // it was written.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** A candidate value with the excerpt it claims to come from — the one shape
 * every field reduces to before it is checked, whichever source produced it. */
interface Candidate<T> {
  value: T;
  source: FieldSource;
  pageIndex: number;
  excerpt: string;
}

/** The parser's reading wins when it has one; the model is asked only for the
 * gaps. Both come out as the same Candidate, and both are then checked by
 * `resolve` below — the parser gets no shortcut. */
/** Which page a parser evidence line came from.
 *
 * `analyze` is handed every page's text joined together, so its `lineIndex`
 * counts non-blank lines across the whole scan. Each page contributes a known
 * number of them, so a running total maps the global index back — exactly,
 * without re-searching the text and without the ambiguity a text search would
 * hit when two pages print the same line. Out of range falls back to page 0,
 * which is where a single-page scan's lines all are anyway. */
function pageOfLine(lineIndex: number, pages: readonly Page[]): number {
  let remaining = lineIndex;
  for (const [pageIndex, page] of pages.entries()) {
    const count = evidenceLines(page.text).length;
    if (remaining < count) return pageIndex;
    remaining -= count;
  }
  return 0;
}

function candidateFor<P, T>(
  parsed: ParsedField<P> | null,
  fromParsed: (value: P) => T,
  model: { value: T; evidence: { pageIndex: number; excerpt: string } } | undefined,
  pages: readonly Page[],
): Candidate<T> | undefined {
  if (parsed !== null) {
    return {
      value: fromParsed(parsed.value),
      source: "parser",
      pageIndex: pageOfLine(parsed.evidence.lineIndex, pages),
      excerpt: parsed.evidence.text,
    };
  }
  if (model === undefined) return undefined;
  return { value: model.value, source: "model", pageIndex: model.evidence.pageIndex, excerpt: model.evidence.excerpt };
}

/**
 * Runs both guards over a candidate and records it as unverified when either
 * fails. `statesValue` is the per-type half: an amount is checked against the
 * line's amounts, a string against the line's text, a date against the date
 * the parser reads back out of that line.
 *
 * The parser's own fields go through this too. They used to be stamped
 * `verified: true` unread, on the reasoning that the parser is the trusted
 * baseline — but the corpus measurement is that the parser returns a merchant
 * on 12 of 12 receipts and is right about 7, so "deterministic" is not the
 * same as "checked", and the README says so in as many words. What this
 * change buys is one definition of `verified` with no source exempt from it,
 * not new detections: measured over all 12 fixtures, every parser field still
 * verifies, EN-05's cashier-ID total included. That is the honest result and
 * it is worth stating, because the guard asks "was this invented?" and the
 * parser does not invent — it misreads a real line. Catching THAT is what the
 * corpus baseline and the disagreement report are for.
 */
function resolve<T>(
  path: string,
  candidate: Candidate<T> | undefined,
  statesValue: (excerpt: string, value: T) => boolean,
  pages: readonly Page[],
  unverified: string[],
): ExtractedField<T> | undefined {
  if (candidate === undefined) return undefined;
  const { value, source, pageIndex, excerpt } = candidate;
  const verified = verifyEvidence(excerpt, pageText(pages, pageIndex)) && statesValue(excerpt, value);
  if (!verified) unverified.push(path);
  return { value, source, evidence: { pageIndex, excerpt, box: box(pages, pageIndex, excerpt) }, verified };
}

/** A date's guard cannot be a substring test: the model reports ISO
 * (`2026-07-02`) while the line prints whatever the till printed
 * (`2026/07/02`, `26.07.02`). So the parser re-reads the cited line with the
 * same `parseDate` it used to derive dates in the first place, and the
 * claimed day has to be the day that line states. A line the parser cannot
 * read a date out of fails closed — the value is kept and marked, never
 * dropped. */
function excerptStatesDate(excerpt: string, isoDate: string): boolean {
  const reparsed = parseDate(excerpt);
  return reparsed !== null && toIsoDate(reparsed) === isoDate;
}

/**
 * Reports when the parser reads a different number out of the cited line than
 * the claim says. It applies to MODEL values only, and callers must not run it
 * on a parser value: both sides would be the same `analyze()` over the same
 * text, so it could only ever agree.
 *
 * That was not a theoretical gap. Run over all 12 fixtures with a no-op model
 * client, `disagreements` came back empty on 12 of 12 — including the five
 * totals `expected.json` marks wrong, among them EN-05's 78901234567890 read
 * off a cashier ID. A reader could take that empty list as the parser having
 * been cross-checked and found consistent. Nothing cross-checks the parser:
 * `docs/notes/corpus-baseline.md` is the record of where it is wrong, and it
 * was made by comparing against a human-written manifest, not by the pipeline.
 */
function noteDisagreement(
  path: string,
  excerpt: string,
  claimed: number,
  referenceDate: Date,
  disagreements: Disagreement[],
): void {
  const reparsed = reparseAmount(excerpt, referenceDate);
  if (reparsed !== null && reparsed !== claimed) {
    disagreements.push({ path, parserValue: reparsed, modelValue: claimed });
  }
}

function buildItem(
  item: ModelReply["items"][number],
  index: number,
  pages: readonly Page[],
  referenceDate: Date,
  unverified: string[],
  disagreements: Disagreement[],
): ExtractedItem {
  const path = `items[${index}]`;
  const { pageIndex, excerpt } = item.evidence;
  const text = pageText(pages, pageIndex);
  // Every part of the item has to be stated on the cited line, not just the
  // money. Checking the amount alone let a model quote a real priced row and
  // attach whatever name and quantity it liked — `{name: "Whisky", quantity:
  // 99, amountMinor: 4500}` citing `커피 4,500` verified, and both clients
  // then showed the invented name under a verified badge. A quantity is
  // optional in the schema precisely so the model omits what it cannot read;
  // one it does supply is a claim like any other and is checked as one.
  const verified =
    verifyEvidence(excerpt, text) &&
    excerptContainsAmount(excerpt, item.amountMinor) &&
    excerptContainsText(excerpt, item.name) &&
    (item.quantity === undefined || excerptContainsAmount(excerpt, item.quantity));
  if (!verified) unverified.push(path);
  noteDisagreement(path, excerpt, item.amountMinor, referenceDate, disagreements);
  return {
    name: item.name,
    quantity: item.quantity,
    amountMinor: item.amountMinor,
    source: "model",
    evidence: { pageIndex, excerpt, box: box(pages, pageIndex, excerpt) },
    verified,
  };
}

function emptyReceipt(): ParsedReceipt {
  return { merchant: null, purchaseDate: null, paidTotal: null, currency: "KRW", reference: null, items: [], tenders: [], lines: [] };
}

export async function extract(
  request: { pages: readonly Page[] },
  client: ModelClient,
  referenceDate: Date,
): Promise<ExtractionResponse> {
  const { pages } = request;
  // The parser reads the WHOLE scan as one document, because that is what it
  // is — three captures of one receipt, not three receipts. Reading page 0
  // alone was worse than incomplete: on a scan whose first page is the shop
  // header and whose totals are on the second, `analyze`'s largest-amount
  // fallback fires on a page with no money at all, so a street number ships
  // as the paid total. Measured: pages `["BLUE BOTTLE COFFEE / 123 MAIN ST /
  // SAN FRANCISCO CA", "SANDWICH 12.99 / TAX 1.05 / TOTAL $14.04"]` returned
  // `paidTotal 123, verified: true` from `123 MAIN ST`, and currency KRW.
  // The mobile app scans with maxPages: 3, so this is its ordinary path.
  const parsed = pages.length === 0 ? emptyReceipt() : analyze(pages.map((page) => page.text).join("\n"), referenceDate);

  // Only the field NAMES the parser left blank — never its values. See
  // ModelClient: the prompt has always said "the fields the parser left
  // blank", and until now nothing told the model which those were.
  const missingFields = (["merchant", "purchaseDate", "paidTotal", "reference"] as const).filter(
    (field) => parsed[field] === null,
  );
  const raw = await client.complete({ pages, missingFields });
  const modelParse = ModelReplySchema.safeParse(raw);
  // A reply that fails the schema entirely (missing evidence, wrong types,
  // an invented field) yields no model-derived facts rather than a crash —
  // the parser's own fields still stand. This is a deliberate boundary, not
  // an oversight: it is a schema *rejection*, one level upstream of the
  // per-value verified/unverified guard this file runs below, so nothing is
  // added to `unverified` for it — the spec's "invalid, not merely
  // suspect" wording (docs/specs/2026-08-19-receipt-evidence-design.md)
  // licenses treating a structurally invalid reply as no reply at all. The
  // rejection is reported, not silent: `modelReply.accepted` is what tells
  // an empty-because-rejected reply apart from an empty-because-nothing-
  // found one, since `items: []` alone reads identically either way.
  const reply: ModelReply = modelParse.success ? modelParse.data : { items: [] };
  const modelReply: ExtractionResponse["modelReply"] = modelParse.success
    ? { accepted: true }
    : { accepted: false, reason: modelParse.error.message };

  const unverified: string[] = [];
  const disagreements: Disagreement[] = [];

  const same = <T,>(value: T): T => value;
  const merchant = resolve(
    "fields.merchant",
    candidateFor(parsed.merchant, same, reply.merchant, pages),
    excerptContainsText,
    pages,
    unverified,
  );
  const purchaseDate = resolve(
    "fields.purchaseDate",
    candidateFor(parsed.purchaseDate, toIsoDate, reply.purchaseDate, pages),
    excerptStatesDate,
    pages,
    unverified,
  );
  const paidTotalCandidate = candidateFor(parsed.paidTotal, same, reply.paidTotal, pages);
  const paidTotal = resolve("fields.paidTotal", paidTotalCandidate, excerptContainsAmount, pages, unverified);
  // Separate from the guard, and runs whatever the guard decided: a value can
  // be verified and still disagree. MODEL values only — see noteDisagreement.
  if (paidTotalCandidate?.source === "model") {
    noteDisagreement("fields.paidTotal", paidTotalCandidate.excerpt, paidTotalCandidate.value, referenceDate, disagreements);
  }
  const reference = resolve(
    "fields.reference",
    candidateFor(parsed.reference, same, reply.reference, pages),
    excerptContainsText,
    pages,
    unverified,
  );

  const items = reply.items.map((item, index) => buildItem(item, index, pages, referenceDate, unverified, disagreements));
  const tenders = parsed.tenders
    .map((tender, index) =>
      resolve(
        `tenders[${index}]`,
        {
          value: tender.amountMinor,
          source: "parser",
          pageIndex: pageOfLine(tender.evidence.lineIndex, pages),
          excerpt: tender.evidence.text,
        },
        excerptContainsAmount,
        pages,
        unverified,
      ),
    )
    .filter((tender): tender is ExtractedField<number> => tender !== undefined);

  const arithmetic = checkArithmetic(
    items,
    paidTotal?.value ?? null,
    tenders.filter((tender) => tender.verified).map((tender) => tender.value),
  );

  return {
    fields: { merchant, purchaseDate, paidTotal, reference, currency: parsed.currency },
    items,
    tenders,
    arithmetic,
    unverified,
    disagreements,
    modelReply,
  };
}
