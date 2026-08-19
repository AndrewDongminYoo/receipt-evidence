/**
 * Normalizes text for comparison in evidence verification and anchoring.
 *
 * Both verifyEvidence (does an excerpt appear in the page text?) and anchorToLines
 * (which OCR line contains this excerpt?) must answer "is this excerpt really that
 * line?" identically. They use this single definition to ensure they cannot drift.
 *
 * The normalization applies NFKC Unicode composition and collapses horizontal
 * whitespace (tabs, multiple spaces) to single spaces, while preserving newlines
 * to allow per-line comparisons. Trailing and leading whitespace is trimmed.
 *
 * Note: the empty/whitespace rejection (returning false/null for empty input)
 * stays with each CALLER, not here, because the two functions return different
 * types for the empty case:
 * - verifyEvidence returns a boolean (false)
 * - anchorToLines returns OcrLine["frame"] | null
 */
export function normalize(value: string): string {
  return value.normalize("NFKC").replace(/[^\S\n]+/g, " ").trim();
}
