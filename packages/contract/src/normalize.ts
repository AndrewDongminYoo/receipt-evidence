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

/**
 * How many adjacent lines one excerpt may span.
 *
 * Evidence used to be exactly one line. The first real device capture showed
 * why that could not hold: a Korean receipt prints an item's name, its
 * barcode and its price on three separate lines, so the model quoted all
 * three and the guard rejected a correct reading. Requiring one line meant
 * most Korean line items could never verify.
 *
 * The cap is what keeps the relaxation honest. Without one, a model could
 * quote the entire page as its "excerpt" and every value in it would verify —
 * the empty-excerpt failure wearing a longer coat. It is a bound on quoting
 * the page whole, not an attempt to be tight: a receipt runs to dozens of
 * lines, so four is still nowhere near it.
 *
 * Four is what real captures needed. The first (a 7-Eleven jelly receipt)
 * ran to three, because OCR kept `barcode 1 2,500` on one line. The second,
 * the same store, split the quantity onto its own: name / `8801019320293` /
 * `1` / `2,000` — four, and at a cap of three a correct model reading was
 * rejected again. Raised against that capture, which is exactly the evidence
 * the previous note asked for before raising it.
 *
 * ponytail: fixed cap, raise it only against a real capture that needs more.
 */
export const MAX_EVIDENCE_LINES = 4;

/**
 * Every contiguous run of lines whose text contains `excerpt`.
 *
 * The single definition `verifyEvidence` and `anchorToLines` both call, for
 * the same reason they both call `normalize`: they answer one question — "is
 * this excerpt really those lines?" — and a value that verified against a run
 * the anchor could not find would be unshowable. Returning every match rather
 * than the first lets the anchor refuse to draw a box when more than one run
 * would do, which is the difference between no box and a wrong box.
 *
 * Adjacency is the whole constraint: lines must be consecutive and in order,
 * so a model cannot stitch a label from the top of the receipt onto an amount
 * from the bottom. Each line is normalised on its own, so the two callers
 * compare identical text whether they start from a whole page or from the
 * scanner's per-line geometry.
 */
export function findLineRuns(excerpt: string, lines: readonly string[]): { start: number; length: number }[] {
  const needle = normalize(excerpt);
  if (needle === "") return [];
  const normalised = lines.map(normalize);
  const runs: { start: number; length: number }[] = [];
  for (let start = 0; start < normalised.length; start += 1) {
    const limit = Math.min(MAX_EVIDENCE_LINES, normalised.length - start);
    for (let length = 1; length <= limit; length += 1) {
      const at = normalised.slice(start, start + length).join("\n").indexOf(needle);
      if (at === -1) continue;
      // The match has to BEGIN in this run's first line. Otherwise it lies
      // wholly inside a run that starts later, and this one is that run with
      // an unquoted line padded in front — which would box text the excerpt
      // never mentioned, and count as a second match, making an unambiguous
      // excerpt look ambiguous and lose its box entirely.
      if (at > (normalised[start] ?? "").length) break;
      // The shortest run that contains it is the one that means it: a longer
      // run from the same start could only add trailing lines the excerpt
      // does not reach.
      runs.push({ start, length });
      break;
    }
  }
  return runs;
}
