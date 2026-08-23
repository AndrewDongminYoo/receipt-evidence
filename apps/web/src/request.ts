// Request validation for POST /api/extract, kept out of the route file so a
// test can exercise it without importing the handler — importing the handler
// builds the OpenAI client, and a test that reaches the model call is a test
// that makes a network call. Nothing in this repository does that.
import type { Page } from "./extract.ts";

interface RequestBody {
  pages: Page[];
}

// Checking only `Array.isArray(pages)` let {"pages":[{}]} and {"pages":[null]}
// through, and they died inside the parser instead — a 502 whose body read
// "Cannot read properties of undefined (reading 'split')". That is a bad
// request, and the caller is entitled to hear which part of it was bad.
export function isPage(value: unknown): value is Page {
  if (typeof value !== "object" || value === null) return false;
  const { text, lines, imageDataUrl } = value as { text?: unknown; lines?: unknown; imageDataUrl?: unknown };
  if (typeof text !== "string") return false;
  if (!Array.isArray(lines)) return false;
  if (imageDataUrl !== undefined && typeof imageDataUrl !== "string") return false;
  return lines.every((line) => {
    if (typeof line !== "object" || line === null) return false;
    const { text: lineText, frame } = line as { text?: unknown; frame?: unknown };
    if (typeof lineText !== "string" || typeof frame !== "object" || frame === null) return false;
    const box = frame as Record<string, unknown>;
    return ["x", "y", "width", "height"].every((key) => typeof box[key] === "number");
  });
}

export function isRequestBody(value: unknown): value is RequestBody {
  if (typeof value !== "object" || value === null) return false;
  const { pages } = value as { pages?: unknown };
  return Array.isArray(pages) && pages.every(isPage);
}

/**
 * The "not in the future" reference `analyze` compares receipt dates against.
 *
 * A day of slack, because the rule runs in the SERVER's zone and the receipt
 * was printed in its own. `selectDate` rejects a date later than this, and the
 * parser builds each candidate as LOCAL midnight — so on a UTC-deployed server
 * every Korean receipt bought between 00:00 and 09:00 KST reads as future-dated
 * and loses its purchaseDate entirely. Measured on one instant:
 * `analyze("GS25\\n2026.07.02\\n합계 4,500", new Date(Date.UTC(2026,6,1,23)))`
 * returns the date under TZ=Asia/Seoul and null under TZ=UTC.
 *
 * One day covers every offset on earth (max ±14h). The cost is that a receipt
 * dated tomorrow is accepted rather than dropped — and it still ships with the
 * line it was read from, which is the whole point of this system.
 */
export function extractionReferenceDate(now: Date): Date {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
