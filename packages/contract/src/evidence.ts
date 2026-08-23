// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:176-184.

/** A recognised line and its position among recognised lines (blanks excluded). */
export interface OcrEvidence {
  lineIndex: number;
  text: string;
}

export function evidenceLines(rawText: string): OcrEvidence[] {
  // Filter first, then assign indices. lineIndex counts recognised lines
  // (non-blank only), matching Dart's `.indexed` on the filtered iterable.
  //
  // It does NOT line up with the scanner's `ocrLines[]`, whatever this comment
  // used to claim. react-native-receipt-scanner@0.8.0's own types say so:
  // "Lines the platform could not place (no bounding box, or a box that clamps
  // to zero area) are omitted, so this does not line up index-wise with
  // ocrText — read OcrLine.text for each box instead." Nothing indexes into
  // ocrLines today (`anchorToLines` matches by text), and nothing should start:
  // one unplaceable line would shift every box below it onto the wrong row.
  const trimmed = rawText.split("\n").map((line) => line.trim());
  const recognised = trimmed.filter((line) => line.length > 0);
  return recognised.map((text, lineIndex) => ({ lineIndex, text }));
}
