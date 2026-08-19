export interface OcrLine {
  text: string;
  frame: { x: number; y: number; width: number; height: number };
}

export function anchorToLines(
  excerpt: string,
  lines: readonly OcrLine[],
): OcrLine["frame"] | null {
  const normalize = (value: string) => value.normalize("NFKC").replace(/[^\S\n]+/g, " ").trim();

  const normalizedExcerpt = normalize(excerpt);
  // An empty (or whitespace-only) excerpt is not evidence of anything, matching
  // the behavior of verifyEvidence in guards.ts. Without this check, the function
  // fails open for the most ordinary hallucination, a model returning "".
  if (normalizedExcerpt === "") return null;

  for (const line of lines) {
    if (normalize(line.text).includes(normalizedExcerpt)) {
      return line.frame;
    }
  }

  return null;
}
