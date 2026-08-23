import { findLineRuns } from "./normalize.ts";

export interface OcrLine {
  text: string;
  frame: { x: number; y: number; width: number; height: number };
}

/**
 * The box to draw over the lines an excerpt was read from, or `null` when
 * there is no single answer.
 *
 * Shares `findLineRuns` with `verifyEvidence` so the two cannot disagree
 * about what a quote is — a value that verified but could not be anchored
 * would be unshowable.
 *
 * Two things fail closed. An excerpt matching more than one run is not boxed:
 * a receipt that repeats a row (`SUBTOTAL / TAX / TOTAL / VISA` over `5.50 /
 * 0.53 / 6.03 / 6.03`) would otherwise put the VISA row's evidence on the
 * TOTAL row — right value, wrong pixels, no signal, which is worse than no
 * box in a system whose claim is that a value is shown beside the pixels it
 * was read from. And an empty excerpt matches nothing, for the same reason
 * the guard rejects it.
 */
export function anchorToLines(excerpt: string, lines: readonly OcrLine[]): OcrLine["frame"] | null {
  const runs = findLineRuns(
    excerpt,
    lines.map((line) => line.text),
  );
  if (runs.length !== 1) return null;
  const run = runs[0] as { start: number; length: number };
  const frames = lines.slice(run.start, run.start + run.length).map((line) => line.frame);
  return frames.length === 0 ? null : enclosing(frames);
}

/** The smallest box containing every line the excerpt spanned. A single-line
 * run returns that line's own frame unchanged. */
function enclosing(frames: readonly OcrLine["frame"][]): OcrLine["frame"] {
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
