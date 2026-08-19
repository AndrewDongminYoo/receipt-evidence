import { normalize } from "./normalize.ts";

// excerptContainsValue is ported from
// catfood-feeder/src/lib/source-extraction.ts:288-328. Its helper
// normalizeDecimalLiteral (and the DECIMAL_COMMA regex it uses) is not
// defined in that file as the plan brief states — both actually live in
// catfood-feeder/src/lib/excerpt-match.ts:6,12-31, imported into
// source-extraction.ts. Ported from there instead; behaviour is unchanged.
//
// verifyEvidence is new: it is not a port.
//
// The two guards are independent: verifyEvidence checks the excerpt is real
// (a substring of the page), excerptContainsValue checks the claimed value is
// in the excerpt. Neither implies the other — a caller must run both.

/**
 * Matches a European decimal-comma literal ("2,5"): a comma followed by
 * exactly one or two digits can only be a decimal point, never a thousands
 * grouping (which is always exactly three digits), so this never overlaps
 * with the thousands-grouped case below.
 */
const DECIMAL_COMMA = /^-?\d+,\d{1,2}$/;

function normalizeDecimalLiteral(value: string): string | null {
  const match = value.match(/^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || (!match[2] && !match[3])) return null;
  const sourceInteger = match[2] || "0";
  const sourceFraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;

  const digits = `${sourceInteger}${sourceFraction}`;
  const decimalIndex = sourceInteger.length + exponent;
  const expanded =
    decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : decimalIndex >= digits.length
        ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  const [expandedInteger = "0", expandedFraction = ""] = expanded.split(".");
  const integer = expandedInteger.replace(/^0+(?=\d)/, "") || "0";
  const fraction = expandedFraction.replace(/0+$/, "");
  const sign = match[1] === "-" && (integer !== "0" || fraction) ? "-" : "";
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

/** Does the excerpt state exactly this numeric value (as a single token)? */
export function excerptContainsValue(excerpt: string, value: number): boolean {
  const normalizedExcerpt = excerpt.normalize("NFKC").replace(/−/g, "-");
  if (normalizedExcerpt.includes("⁄")) return false;
  const numericTokens = normalizedExcerpt.match(/-?(?=[\d,.]*\d)[\d,.]+/g);
  const numericToken = numericTokens?.[0];
  const tokenStart = numericToken ? normalizedExcerpt.indexOf(numericToken) : -1;
  const leadingDecimalFollowsLabel =
    numericToken?.startsWith(".") &&
    tokenStart > 0 &&
    /[\p{L}\p{N}]/u.test(normalizedExcerpt[tokenStart - 1] ?? "");
  if (
    numericTokens?.length !== 1 ||
    !numericToken ||
    leadingDecimalFollowsLabel ||
    !(
      DECIMAL_COMMA.test(numericToken) ||
      /^-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/.test(numericToken)
    )
  )
    return false;
  const normalizedToken = normalizeDecimalLiteral(
    DECIMAL_COMMA.test(numericToken) ? numericToken.replace(",", ".") : numericToken.replace(/,/g, ""),
  );
  const normalizedValue = normalizeDecimalLiteral(String(value));
  return (
    normalizedToken !== null &&
    normalizedValue !== null &&
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER &&
    normalizedToken === normalizedValue
  );
}

/**
 * Does the excerpt occur verbatim (NFKC-normalised, whitespace-collapsed) within
 * a single line of the page text?
 *
 * Matching is per-line, not across the whole page: evidence in this system IS a
 * line (OcrEvidence is one line), and Task 12's anchoring maps an excerpt back to
 * a single entry of the scanner's ocrLines[] to draw a box on the image. An
 * excerpt spanning two lines could never be anchored, so a cross-line match would
 * produce a value that verifies but cannot be shown to the reader — the guard and
 * the anchor have to agree about what a quote is. Whitespace is still collapsed
 * *within* each line, because OCR spacing wobbles there and that tolerance is
 * wanted.
 */
export function verifyEvidence(excerpt: string, pageText: string): boolean {
  const normalizedExcerpt = normalize(excerpt);
  // An empty (or whitespace-only) excerpt is not evidence of anything, and every
  // string contains the empty string — without this check the guard fails open
  // for the most ordinary hallucination, a model returning "". A guard's default
  // answer must be "no".
  if (normalizedExcerpt === "") return false;
  return normalize(pageText)
    .split("\n")
    .some((line) => line.includes(normalizedExcerpt));
}
