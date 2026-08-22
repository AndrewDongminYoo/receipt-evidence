// The extraction pipeline: parser first, model for whatever the parser could
// not derive, then the guards from packages/contract decide what gets to
// claim `verified: true`. Takes the model client as a parameter (Task 14
// brief) so tests substitute a fake and never call OpenAI.
import { analyze } from "@receipt-evidence/contract/analyze";
import type { ParsedField, ParsedReceipt } from "@receipt-evidence/contract/analyze";
import { verifyEvidence, excerptContainsValue } from "@receipt-evidence/contract/guards";
import { checkArithmetic } from "@receipt-evidence/contract/arithmetic";
import { anchorToLines } from "@receipt-evidence/contract/anchor";
import { ModelReplySchema } from "@receipt-evidence/contract/schema";
import type { ModelReply } from "@receipt-evidence/contract/schema";
import type { ModelClient } from "./model-client.ts";

import type {
  Disagreement,
  ExtractedField,
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

/** A field the parser already derived is the trusted baseline: it is not run
 * through the guards, and it is always `verified: true`. */
function parserField<T>(
  pages: readonly Page[],
  parsed: ParsedField<T>,
  toValue: (value: T) => T = (value) => value,
): ExtractedField<T> {
  return {
    value: toValue(parsed.value),
    source: "parser",
    evidence: { pageIndex: 0, excerpt: parsed.evidence.text, box: box(pages, 0, parsed.evidence.text) },
    verified: true,
  };
}

function resolveStringField(
  path: string,
  parsed: ParsedField<string> | null,
  model: { value: string; evidence: { pageIndex: number; excerpt: string } } | undefined,
  pages: readonly Page[],
  unverified: string[],
): ExtractedField<string> | undefined {
  if (parsed !== null) return parserField(pages, parsed);
  if (model === undefined) return undefined;
  const { pageIndex, excerpt } = model.evidence;
  const verified = verifyEvidence(excerpt, pageText(pages, pageIndex));
  if (!verified) unverified.push(path);
  return { value: model.value, source: "model", evidence: { pageIndex, excerpt, box: box(pages, pageIndex, excerpt) }, verified };
}

function resolveDateField(
  path: string,
  parsed: ParsedField<Date> | null,
  model: { value: string; evidence: { pageIndex: number; excerpt: string } } | undefined,
  pages: readonly Page[],
  unverified: string[],
): ExtractedField<string> | undefined {
  if (parsed !== null) return parserField(pages, { value: toIsoDate(parsed.value), evidence: parsed.evidence });
  if (model === undefined) return undefined;
  const { pageIndex, excerpt } = model.evidence;
  const verified = verifyEvidence(excerpt, pageText(pages, pageIndex));
  if (!verified) unverified.push(path);
  return { value: model.value, source: "model", evidence: { pageIndex, excerpt, box: box(pages, pageIndex, excerpt) }, verified };
}

function resolveNumberField(
  path: string,
  parsed: ParsedField<number> | null,
  model: { value: number; evidence: { pageIndex: number; excerpt: string } } | undefined,
  pages: readonly Page[],
  referenceDate: Date,
  unverified: string[],
  disagreements: Disagreement[],
): ExtractedField<number> | undefined {
  if (parsed !== null) return parserField(pages, parsed);
  if (model === undefined) return undefined;
  const { pageIndex, excerpt } = model.evidence;
  const text = pageText(pages, pageIndex);
  const verified = verifyEvidence(excerpt, text) && excerptContainsValue(excerpt, model.value);
  if (!verified) unverified.push(path);
  const reparsed = reparseAmount(excerpt, referenceDate);
  if (reparsed !== null && reparsed !== model.value) {
    disagreements.push({ path, parserValue: reparsed, modelValue: model.value });
  }
  return { value: model.value, source: "model", evidence: { pageIndex, excerpt, box: box(pages, pageIndex, excerpt) }, verified };
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
  const verified = verifyEvidence(excerpt, text) && excerptContainsValue(excerpt, item.amountMinor);
  if (!verified) unverified.push(path);
  const reparsed = reparseAmount(excerpt, referenceDate);
  if (reparsed !== null && reparsed !== item.amountMinor) {
    disagreements.push({ path, parserValue: reparsed, modelValue: item.amountMinor });
  }
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
  return { merchant: null, purchaseDate: null, paidTotal: null, currency: "KRW", reference: null, items: [], lines: [] };
}

export async function extract(
  request: { pages: readonly Page[] },
  client: ModelClient,
  referenceDate: Date,
): Promise<ExtractionResponse> {
  const { pages } = request;
  const primaryPage = pages[0];
  // The deterministic parser (analyze.ts) takes one document's raw text; a
  // multi-page receipt still has one primary page for header fields, same as
  // due_back's own single-document assumption. Items are asked from the
  // model across every page (see model-client.ts's prompt), not just this one.
  const parsed = primaryPage === undefined ? emptyReceipt() : analyze(primaryPage.text, referenceDate);

  const raw = await client.complete({ pages });
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

  const merchant = resolveStringField("fields.merchant", parsed.merchant, reply.merchant, pages, unverified);
  const purchaseDate = resolveDateField("fields.purchaseDate", parsed.purchaseDate, reply.purchaseDate, pages, unverified);
  const paidTotal = resolveNumberField(
    "fields.paidTotal",
    parsed.paidTotal,
    reply.paidTotal,
    pages,
    referenceDate,
    unverified,
    disagreements,
  );
  const reference = resolveStringField("fields.reference", parsed.reference, reply.reference, pages, unverified);

  const items = reply.items.map((item, index) => buildItem(item, index, pages, referenceDate, unverified, disagreements));

  const arithmetic = checkArithmetic(items, paidTotal?.value ?? null);

  return {
    fields: { merchant, purchaseDate, paidTotal, reference, currency: parsed.currency },
    items,
    arithmetic,
    unverified,
    disagreements,
    modelReply,
  };
}
