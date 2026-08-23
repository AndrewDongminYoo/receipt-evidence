import { findLineRuns, normalize } from "./normalize.ts";
import { amountsOnLine } from "./amounts.ts";

// Two independent questions, and neither implies the other, so a caller must
// ask both: verifyEvidence asks whether the excerpt is real (does it occur on
// one line of the page), and excerptContainsAmount / excerptContainsText ask
// whether the claimed value is actually stated in that excerpt.
//
// This file used to carry `excerptContainsValue`, a port of
// catfood-feeder/src/lib/excerpt-match.ts:6,12-31. It was REMOVED on
// 2026-08-22 after a review probe showed it could not do the job here, and
// keeping a ported-but-unusable guard would only invite a future reader to
// wire it back in. Two measured failures, both run rather than reasoned:
//
//   excerptContainsValue("SANDWICH  12.99", 1299) === false
//   excerptContainsValue("커피 2 4,500", 4500)     === false
//
// The first is the unit mismatch: it compared the excerpt's printed decimal
// against `String(value)`, so every correct USD amount in minor units failed,
// and half this corpus is English. The port's own test even pinned that as
// expected, with the comment "minor units are the caller's job" — and no
// caller ever did that job. The second is the token-count rule: it required
// the excerpt to hold EXACTLY ONE numeric token, which is fine for
// catfood-feeder's tight quoted spans but not for a whole OCR line, where a
// quantity beside a price is the ordinary case (schema.ts invites `quantity`,
// and total.ts:22 documents `TOTAL 2 ITEMS $24.95` as a real total shape).
//
// Together those made the `unverified` list report the opposite of the truth:
// honest values were flagged while a fabricated string sailed through, since
// nothing checked string or date values at all.

/**
 * Does the excerpt state this money value?
 *
 * "State" is decided by the parser's own reading of the line
 * (`amountsOnLine`), so the guard and the parser can never disagree about
 * what an amount is or how it scales to minor units — a token with a decimal
 * part is cents, one without is already minor units, and a digit run too long
 * to be money is skipped as a barcode. Any of the line's amounts may match:
 * a receipt row routinely prints a quantity beside a price.
 *
 * WHICH of a line's amounts the value ought to be is a different question,
 * and this guard deliberately does not answer it — `extract()` re-reads the
 * cited line with the parser and reports a disagreement. This one only asks
 * whether the number was made up.
 */
export function excerptContainsAmount(excerpt: string, amountMinor: number): boolean {
  if (!Number.isInteger(amountMinor)) return false;
  return amountsOnLine(excerpt.normalize("NFKC")).includes(amountMinor);
}

/** Characters that make two neighbouring glyphs part of one token. `-` and
 * `_` are in because a reference number is written `A-12345`; `.` and `,` are
 * out so a value at the end of a sentence still matches. */
const TOKEN_CHARACTER = /[\p{L}\p{N}_-]/u;

/**
 * Does the excerpt state this text value, compared the way `verifyEvidence`
 * compares (NFKC, whitespace collapsed) so the two cannot drift?
 *
 * The match must stand on its own token boundaries. A bare substring test
 * verified values the line never stated: `("승인번호 A-12345", "12345")` was
 * true, so a model reporting a truncated reference shipped as fact, and
 * `("SUBTOTAL 12.99", "TOTAL")` was true for the same reason. The amount
 * guard above avoids this by reading the line into tokens; this is the
 * string equivalent.
 *
 * Fails closed on an empty value for the same reason `verifyEvidence` fails
 * closed on an empty excerpt: every string contains the empty string, so
 * without this a model returning "" for a merchant would have it published
 * as verified.
 */
export function excerptContainsText(excerpt: string, value: string): boolean {
  const needle = normalize(value);
  if (needle === "") return false;
  const haystack = normalize(excerpt);
  const startsToken = TOKEN_CHARACTER.test(needle[0] ?? "");
  const endsToken = TOKEN_CHARACTER.test(needle[needle.length - 1] ?? "");
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = at === 0 ? "" : (haystack[at - 1] ?? "");
    const after = haystack[at + needle.length] ?? "";
    // Only an edge where BOTH the needle and its neighbour are token
    // characters is a cut through the middle of a word.
    const cutBefore = startsToken && before !== "" && TOKEN_CHARACTER.test(before);
    const cutAfter = endsToken && after !== "" && TOKEN_CHARACTER.test(after);
    if (!cutBefore && !cutAfter) return true;
  }
  return false;
}

/**
 * Does the excerpt occur within one contiguous run of the page's lines?
 *
 * Matching is per-line rather than over the whole page because evidence has
 * to be showable: `anchorToLines` maps the same excerpt back to the scanner's
 * geometry to draw a box, and an excerpt stitched from unrelated parts of a
 * receipt could not be boxed at all. Both call `findLineRuns`, so what counts
 * as a quote is defined once.
 *
 * A run may span up to `MAX_EVIDENCE_LINES` ADJACENT lines. It was exactly
 * one until the first device capture showed a Korean receipt printing an
 * item's name, barcode and price on three lines — the model quoted all three
 * and a correct reading was rejected. Adjacency is what keeps that honest: a
 * label from the top of the receipt still cannot be joined to an amount from
 * the bottom.
 *
 * Whitespace is collapsed within each line, because OCR spacing wobbles there
 * and that tolerance is wanted.
 */
export function verifyEvidence(excerpt: string, pageText: string): boolean {
  // An empty (or whitespace-only) excerpt is not evidence of anything, and
  // every string contains the empty string — without this the guard fails
  // open for the most ordinary hallucination, a model returning "". The check
  // lives inside findLineRuns, which returns no runs for it; asserting it here
  // too would be a second definition of the same rule.
  return findLineRuns(excerpt, pageText.split("\n")).length > 0;
}
