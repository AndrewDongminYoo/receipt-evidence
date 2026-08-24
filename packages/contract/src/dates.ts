// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:9-17, 97-104.
import type { OcrEvidence } from "./evidence.ts";

// Exported so amounts.ts can strip a date before reading money off the same
// line (receipt_analyzer.dart:466-470's `_withoutDateOrTime`), instead of
// declaring a second date matcher that could drift from this one.
// `g`-flagged: safe with matchAll/replace only. Never call .test() or .exec()
// on this shared instance — either one advances its lastIndex, and the next
// caller resumes mid-string instead of matching from the start.
export const DATE_PATTERN_G =
  /(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})일?|(?<!\d)(\d{1,2})[-/](\d{1,2})[-/](20\d{2})(?!\d)|(?<!\d)(\d{1,2})[-/](\d{1,2})[-/](\d{2})(?!\d)/g;
const EXPIRY_LABEL = /(expir|\bexp\b|유효기간)/i;

/** Rejects a date the calendar does not have — 2026-02-31 round-trips wrong. */
function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? date : null;
}

function dateFromMatch(match: RegExpMatchArray): Date | null {
  if (match[1]) return calendarDate(+match[1], +match[2], +match[3]);
  if (match[6]) return calendarDate(+match[6], +match[4], +match[5]);
  // A two-digit year is this century; receipts from 1926 are not in scope.
  return calendarDate(2000 + +match[9], +match[7], +match[8]);
}

export function parseDate(text: string): Date | null {
  // Ported from receipt_analyzer.dart:482-488: a calendar-invalid match (an
  // OCR-mangled date) does not stop the search — the next match in the same
  // line may still be a real date.
  for (const match of text.matchAll(DATE_PATTERN_G)) {
    const date = dateFromMatch(match);
    if (date) return date;
  }
  return null;
}

export function selectDate(lines: OcrEvidence[], referenceDate: Date): OcrEvidence | null {
  return (
    lines.find((line) => {
      const date = parseDate(line.text);
      // A purchase already happened, so a later date belongs to an expiry, a
      // return window, or a misread year rather than to this receipt.
      return date !== null && !EXPIRY_LABEL.test(line.text) && date <= referenceDate;
    }) ?? null
  );
}
