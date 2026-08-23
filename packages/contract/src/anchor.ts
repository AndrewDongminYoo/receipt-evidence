import { normalize } from "./normalize.ts";

export interface OcrLine {
  text: string;
  frame: { x: number; y: number; width: number; height: number };
}

export function anchorToLines(
  excerpt: string,
  lines: readonly OcrLine[],
): OcrLine["frame"] | null {
  const normalizedExcerpt = normalize(excerpt);
  // An empty (or whitespace-only) excerpt is not evidence of anything, matching
  // the behavior of verifyEvidence in guards.ts. Without this check, the function
  // fails open for the most ordinary hallucination, a model returning "".
  if (normalizedExcerpt === "") return null;

  // Ambiguity fails closed, the same way an empty excerpt does. Returning the
  // FIRST match put the box on the wrong row of the image whenever a receipt
  // repeats a line — `SUBTOTAL / TAX / TOTAL / VISA` over `5.50 / 0.53 / 6.03
  // / 6.03` is a shape total.ts documents, and a model quoting the VISA row's
  // `6.03` verified correctly and got a box drawn on the TOTAL row. Right
  // value, wrong pixels, and no signal that anything was wrong — worse than
  // no box at all in a system whose claim is that a value is shown beside the
  // pixels it was read from. `null` is an already-supported state: the value
  // still verifies and still ships, it just is not boxed.
  const matches = lines.filter((line) => normalize(line.text).includes(normalizedExcerpt));
  return matches.length === 1 ? (matches[0] as OcrLine).frame : null;
}
