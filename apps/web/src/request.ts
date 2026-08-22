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
