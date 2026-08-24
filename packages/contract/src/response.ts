// The wire contract between the extraction endpoint and everything that reads
// it — the demo page, the mobile app, and any future consumer. It lives in
// packages/contract, not in the web app, for the same reason the parser and
// the guards do: one definition of what a receipt fact is, shared by the
// server and the clients, so a renderer cannot drift from what the pipeline
// emits. Moved out of apps/web/src/extract.ts when the mobile app (Task 16)
// needed to render the same response; extract.ts re-exports every name, so
// existing importers are unchanged.
import type { OcrLine } from "./anchor.ts";
import type { ArithmeticCheck } from "./arithmetic.ts";
import type { Currency } from "./types.ts";

export interface Page {
  text: string;
  lines: readonly OcrLine[];
  /** A full `data:<media-type>;base64,...` URL, present only for a page the
   * caller decided to send as an image — below the scanner's OCR floor
   * (spec step 2). The whole URL rather than bare base64 because the media
   * type has to travel with the bytes; the model client hands it straight
   * to the request's `image_url`. */
  imageDataUrl?: string;
}

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EvidenceRef {
  pageIndex: number;
  excerpt: string;
  /** null when the excerpt could not be matched back to an OCR line — the
   * value can still be verified, it just cannot be boxed on the image. */
  box: Frame | null;
}

export type FieldSource = "parser" | "model";

export interface ExtractedField<T> {
  value: T;
  source: FieldSource;
  evidence: EvidenceRef;
  verified: boolean;
}

export interface ExtractedItem {
  name: string;
  quantity?: number;
  amountMinor: number;
  source: FieldSource;
  /** Where the name is printed and where the amount is printed — two separate
   * references because OCR can flatten an item table into columns (issue #3),
   * putting the two many lines apart. On a receipt that prints them together
   * both cite the same line. Each draws its own box. */
  nameEvidence: EvidenceRef;
  amountEvidence: EvidenceRef;
  verified: boolean;
}

/** The parser re-reads the model's own cited excerpt and reports it when its
 * reading differs from the model's claim — independent of whether the value
 * passed the verified/unverified guard. */
export interface Disagreement {
  path: string;
  parserValue: number;
  modelValue: number;
}

export interface ExtractionResponse {
  fields: {
    merchant?: ExtractedField<string>;
    purchaseDate?: ExtractedField<string>;
    paidTotal?: ExtractedField<number>;
    reference?: ExtractedField<string>;
    currency: Currency;
  };
  items: ExtractedItem[];
  /** Explicit additional tender payments, each retained with the same
   * provenance and verification state as a primary field. */
  tenders: ExtractedField<number>[];
  arithmetic: ArithmeticCheck;
  /** Field/item paths that failed a guard. Kept, never dropped — see the
   * plan's one failure rule. */
  unverified: string[];
  disagreements: Disagreement[];
  /** Whether the model's reply passed ModelReplySchema at all. `items: []`
   * means two different things — the model found nothing, or its reply was
   * thrown out — and this is the only field that tells them apart. `reason`
   * is the zod error message only: short and factual, never the raw reply,
   * which may carry receipt contents. */
  modelReply: { accepted: true } | { accepted: false; reason: string };
}
