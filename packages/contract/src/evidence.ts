// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:176-184.

/** A recognised line and its position among recognised lines (blanks excluded). */
export interface OcrEvidence {
  lineIndex: number;
  text: string;
}

export function evidenceLines(rawText: string): OcrEvidence[] {
  // Filter first, then assign indices. lineIndex counts recognised lines
  // (non-blank only), matching Dart's `.indexed` on the filtered iterable.
  // The scanner's `ocrLines[]` is indexed the same way — no blanks, only
  // what was actually recognised.
  const trimmed = rawText.split("\n").map((line) => line.trim());
  const recognised = trimmed.filter((line) => line.length > 0);
  return recognised.map((text, lineIndex) => ({ lineIndex, text }));
}
