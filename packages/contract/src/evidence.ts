// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:176-184.

/** One recognised line, and where it sat in the original OCR text. */
export interface OcrEvidence {
  lineIndex: number;
  text: string;
}

export function evidenceLines(rawText: string): OcrEvidence[] {
  return rawText
    .split("\n")
    // The index is assigned before filtering, so it still points at the raw
    // document — an evidence line the caller cannot locate is not evidence.
    .map((text, lineIndex) => ({ lineIndex, text: text.trim() }))
    .filter((line) => line.text.length > 0);
}
