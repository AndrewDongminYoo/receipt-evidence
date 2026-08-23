// The two decisions the app makes about a capture, kept free of React Native
// so `node --test` can run them: whether a page's text is good enough to
// travel alone, and where a recognised line sits on the rendered image.
//
// Type-only imports on purpose — `react-native-receipt-scanner`'s runtime
// entry pulls in React Native, which no test in this repository loads.
import type { OcrFloor, OcrQuality } from "react-native-receipt-scanner";
import type { Frame } from "@receipt-evidence/contract/response";

/**
 * Whether a captured page's OCR is good enough that its text can travel
 * alone. A page that clears the floor is sent as text; one that does not
 * also uploads its JPEG (spec step 2) — the image leaving the device is the
 * exception the floor exists to gate, not the default.
 *
 * The floor is a parameter rather than a module-level constant so this stays
 * loadable without React Native, and so a caller can widen it per scan the
 * way `ScanReceiptOptions.ocrFloor` does. `App.tsx` passes the package's own
 * `DEFAULT_OCR_FLOOR`.
 *
 * Note this is NOT the package's own rejection gate. That one moves a
 * below-floor capture into `rejectedImages` and drops it from `images`; this
 * app passes `ocrFloor: false` to keep every page and decides here what each
 * page carries. A rejected page is exactly the page that most needs its
 * image sent, so it must not be thrown away first.
 */
export function clearsFloor(quality: OcrQuality | undefined, floor: Required<OcrFloor>): boolean {
  // No quality block means OCR never ran, so there is no text to trust.
  if (quality === undefined) return false;
  if (quality.textLength < floor.minTextLength) return false;
  if (quality.lineCount < floor.minLines) return false;
  // The package treats an absent confidence as satisfying the threshold
  // ("the gate never penalizes a missing field" — OcrFloor.minConfidence in
  // react-native-receipt-scanner's types.ts), and this mirrors it rather
  // than inventing a stricter rule the package would not apply.
  //
  // With DEFAULT_OCR_FLOOR, which is what App.tsx passes, `minConfidence` is
  // 0 — so no confidence in [0, 1] can fall below it and this branch never
  // rejects in production. The shipped gate is 12 characters and 2 lines, and
  // a 13-character garbled read at confidence 0.1 clears it, so the image
  // stays on the device and the model gets only the garbage text. The branch
  // is kept and tested at a raised floor because the threshold is a caller's
  // to set, and because the package itself calls confidence "reporting-only —
  // not a cross-platform enforcement signal until its distributions are
  // validated comparable", which is not this project's call to overrule.
  if (quality.confidence !== undefined && quality.confidence < floor.minConfidence) return false;
  return true;
}

/**
 * Maps an OCR line's box from the captured JPEG's pixel space into the
 * layout the image was actually rendered at.
 *
 * `ReceiptImage.width`/`height` and `OcrLine.frame` share one coordinate
 * space (top-left origin, output-JPEG pixels), and the view renders the
 * image at the container's width with its aspect ratio preserved — so a
 * single width ratio maps both axes. Measuring the rendered width rather
 * than assuming a device ratio is the whole point: the same receipt draws
 * at a different size on every screen.
 */
export function scaleFrame(frame: Frame, imageWidth: number, renderedWidth: number): Frame {
  // A zero or negative width would make every box Infinity and paint the
  // overlay over the whole screen. Nothing to place yet, so place nothing.
  if (imageWidth <= 0 || renderedWidth <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = renderedWidth / imageWidth;
  return {
    x: frame.x * scale,
    y: frame.y * scale,
    width: frame.width * scale,
    height: frame.height * scale,
  };
}
