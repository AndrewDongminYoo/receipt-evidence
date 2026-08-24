"use client";

// The reviewer-facing surface for POST /api/extract (task-15-brief.md). It
// posts OCR text, and the uploaded photo only when the reviewer ticks the
// box for it — an image in the request is transmitted to the model (see
// model-client.ts's buildInput), which is exactly the transfer the mobile
// app's OCR floor exists to gate, so it is not something a page can do to
// someone quietly. It then renders every field/item next to the evidence
// that earned it: source (parser vs model), verified/unverified, the
// arithmetic verdict (including the `agrees: null` "could not be computed"
// state), a rejected model reply, and an evidence box drawn on the image
// when one was anchored.
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { EvidenceRef, ExtractedField, ExtractedItem, ExtractionResponse, Frame } from "../src/extract.ts";
import type { OcrLine } from "@receipt-evidence/contract/anchor";

interface ImageInfo {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = dataUrl;
  });
}

/** OcrLine[] pasted by hand, or from a device capture — the demo has no
 * on-device OCR of its own (task-15-brief.md: "the page has no scanner").
 * Without real per-line frames, anchorToLines has nothing to match against
 * and every box comes back null; this is how a reviewer with real capture
 * data (frame coordinates in the uploaded image's own pixel space) can
 * still see the box-on-image feature exercised. */
function parseLines(raw: string): { lines: OcrLine[]; error: string | null } {
  if (raw.trim() === "") return { lines: [], error: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { lines: [], error: "lines JSON must be an array" };
    // Casting straight to OcrLine[] posted [1,2,3] and [{}] to the server,
    // where anchorToLines read `.text` off a number and the reviewer got a
    // 502 for what is a typo in this box. Say so inline instead, the way the
    // JSON syntax error already is.
    const bad = parsed.findIndex((entry) => !isOcrLine(entry));
    if (bad !== -1) {
      return { lines: [], error: `entry ${bad} is not { text, frame: {x,y,width,height} }` };
    }
    return { lines: parsed as OcrLine[], error: null };
  } catch (err) {
    return { lines: [], error: err instanceof Error ? err.message : "invalid JSON" };
  }
}

function isOcrLine(value: unknown): value is OcrLine {
  if (typeof value !== "object" || value === null) return false;
  const { text, frame } = value as { text?: unknown; frame?: unknown };
  if (typeof text !== "string") return false;
  if (typeof frame !== "object" || frame === null) return false;
  const box = frame as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => typeof box[key] === "number");
}

function SourceBadge({ source }: { source: "parser" | "model" }) {
  return <span className={`badge badge-source-${source}`}>{source}</span>;
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  return (
    <span className={verified ? "badge badge-verified" : "badge badge-unverified"}>
      {verified ? "verified" : "unverified"}
    </span>
  );
}

/** An item whose receipt prints name and amount together cites the same line
 * twice — render (and box) that evidence once, not twice. */
function sameEvidence(a: EvidenceRef, b: EvidenceRef): boolean {
  return a.pageIndex === b.pageIndex && a.excerpt === b.excerpt;
}

function Evidence({ pageIndex, excerpt }: { pageIndex: number; excerpt: string }) {
  return (
    <blockquote className="evidence">
      <span className="evidence-page">page {pageIndex}</span>
      <span className="evidence-excerpt">&ldquo;{excerpt}&rdquo;</span>
    </blockquote>
  );
}

function FieldRow({ label, field }: { label: string; field: ExtractedField<string | number> | undefined }) {
  if (field === undefined) return null;
  return (
    <div className="field-row">
      <div className="field-head">
        <span className="field-label">{label}</span>
        <span className="field-value">{String(field.value)}</span>
        <SourceBadge source={field.source} />
        <VerifiedBadge verified={field.verified} />
      </div>
      <Evidence pageIndex={field.evidence.pageIndex} excerpt={field.evidence.excerpt} />
    </div>
  );
}

/** Boxes collected across every field/item so they can be drawn as one
 * overlay on top of the image, each keyed to the value it came from. */
interface BoxEntry {
  path: string;
  /** Which page's photo this box belongs on. Boxes are anchored against one
   * page's OCR geometry, so painting one on another page's image would point
   * the reader at unrelated text (issue #2). */
  pageIndex: number;
  box: Frame;
  verified: boolean;
}

function collectBoxes(result: ExtractionResponse): BoxEntry[] {
  const boxes: BoxEntry[] = [];
  const push = (path: string, field: ExtractedField<unknown> | undefined) => {
    if (field?.evidence.box) {
      boxes.push({ path, pageIndex: field.evidence.pageIndex, box: field.evidence.box, verified: field.verified });
    }
  };
  push("merchant", result.fields.merchant);
  push("purchaseDate", result.fields.purchaseDate);
  push("paidTotal", result.fields.paidTotal);
  push("reference", result.fields.reference);
  result.items.forEach((item, index) => {
    if (item.nameEvidence.box) {
      boxes.push({
        path: `item[${index}] ${item.name} (name)`,
        pageIndex: item.nameEvidence.pageIndex,
        box: item.nameEvidence.box,
        verified: item.verified,
      });
    }
    // A receipt that prints name and amount on one line cites it twice; one
    // box is enough there, and a second would just double the border.
    if (item.amountEvidence.box && !sameEvidence(item.nameEvidence, item.amountEvidence)) {
      boxes.push({
        path: `item[${index}] ${item.name} (amount)`,
        pageIndex: item.amountEvidence.pageIndex,
        box: item.amountEvidence.box,
        verified: item.verified,
      });
    }
  });
  result.tenders.forEach((tender, index) => {
    if (tender.evidence.box) {
      boxes.push({
        path: `tender[${index}]`,
        pageIndex: tender.evidence.pageIndex,
        box: tender.evidence.box,
        verified: tender.verified,
      });
    }
  });
  return boxes;
}

function ArithmeticVerdict({ arithmetic }: { arithmetic: ExtractionResponse["arithmetic"] }) {
  const { itemSumMinor, claimedTotalMinor, reconciledTenderMinor, agrees } = arithmetic;
  const verdict = agrees === null ? "not-computable" : agrees ? "agrees" : "mismatch";
  const label =
    agrees === null
      ? "could not be computed"
      : reconciledTenderMinor !== null
        ? "reconciled by an additional tender"
        : agrees
          ? "agrees"
          : "mismatch";
  return (
    <section className={`arithmetic arithmetic-${verdict}`}>
      <h2>Arithmetic</h2>
      <p className="arithmetic-verdict">{label}</p>
      <dl>
        <dt>item sum (minor units)</dt>
        <dd>{itemSumMinor ?? "—"}</dd>
        <dt>claimed total (minor units)</dt>
        <dd>{claimedTotalMinor ?? "—"}</dd>
        {reconciledTenderMinor !== null && (
          <>
            <dt>additional tender (minor units)</dt>
            <dd>{reconciledTenderMinor}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

/** One page's inputs. A multi-page scan is a list of these, and the LIST
 * INDEX is the request's pageIndex — the same rule the mobile app follows, so
 * every `page N` in the result points back at the Nth block on this form. */
interface PageInput {
  /** Stable key for React and input ids — list indices shift when a page is
   * removed, and a shifted key would hand page B's image state to page A. */
  id: number;
  ocrText: string;
  linesText: string;
  image: ImageInfo | null;
  // Sending the photo is opt-in, and clearing the file clears the consent
  // with it — a checkbox left ticked from a previous upload must not carry
  // over to the next one.
  sendImage: boolean;
}

export default function Page() {
  const [pageInputs, setPageInputs] = useState<PageInput[]>([
    { id: 0, ocrText: "", linesText: "", image: null, sendImage: false },
  ]);
  const nextPageId = useRef(1);
  // Which file selection is current, PER page. A ref, not state: it has to be
  // readable by an async continuation that started before the newer selection
  // existed, and bumping it must not re-render.
  const selectionCounters = useRef(new Map<number, number>());
  // Which page STRUCTURE an in-flight extraction was posted against. Clearing
  // `result` on removal is not enough: a request already running completes
  // afterwards and `setResult` restores a response whose page indices use the
  // OLD numbering — boxes then land on the wrong photos. Bumped by anything
  // that renumbers or re-images pages; a response is dropped when its
  // captured revision is no longer current.
  const requestRevision = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResponse | null>(null);

  const parsedLines = useMemo(() => pageInputs.map((page) => parseLines(page.linesText)), [pageInputs]);
  const boxes = useMemo(() => (result ? collectBoxes(result) : []), [result]);

  function updatePage(id: number, patch: Partial<PageInput>) {
    setPageInputs((pages) => pages.map((page) => (page.id === id ? { ...page, ...patch } : page)));
  }

  function addPage() {
    const id = nextPageId.current++;
    setPageInputs((pages) => [...pages, { id, ocrText: "", linesText: "", image: null, sendImage: false }]);
  }

  function removePage(id: number) {
    // Removing a page renumbers every page after it, and the result's boxes
    // and `page N` references were computed against the OLD numbering — a
    // stale result would paint them on the wrong photos. Both the shown
    // result and any request still in flight are stale.
    requestRevision.current += 1;
    setResult(null);
    setPageInputs((pages) => pages.filter((page) => page.id !== id));
  }

  async function handleImageChange(id: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Superseding the previous selection comes FIRST, before any early
    // return: clearing the file input must also invalidate a decode still in
    // flight, or image A completes after the clear and restores its preview.
    // Decoding is asynchronous and a superseded selection still resolves —
    // pick photo A, then photo B before A finishes, and A's write lands
    // afterwards. Only the newest selection may write.
    const selection = (selectionCounters.current.get(id) ?? 0) + 1;
    selectionCounters.current.set(id, selection);
    // Everything tied to the OLD image goes next, still before the async
    // decode: the consent, the image itself, and the result (shown OR in
    // flight) whose boxes were computed against it. Resetting only on the
    // clear and error paths left two holes — a checkbox ticked for photo A
    // authorised photo B, and a result rendered for A repainted its boxes
    // onto B's pixels while decoding.
    requestRevision.current += 1;
    updatePage(id, { image: null, sendImage: false });
    setResult(null);
    if (!file) return;
    // Both helpers reject — an unreadable file, an undecodable image (a HEIC
    // on a browser without support, a truncated download). Uncaught, the
    // rejection was silent and the image kept its previous value, so the next
    // extraction drew boxes over the wrong photo.
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const { width, height } = await loadImage(dataUrl);
      if (selectionCounters.current.get(id) !== selection) return;
      updatePage(id, { image: { dataUrl, naturalWidth: width, naturalHeight: height } });
      setError(null);
    } catch (err) {
      if (selectionCounters.current.get(id) !== selection) return;
      setError(`could not read that image: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pageInputs.every((page) => page.ocrText.trim() === "")) {
      setError("paste OCR text first — the pipeline has nothing to parse without it");
      return;
    }
    const badLines = parsedLines.findIndex((parsed) => parsed.error !== null);
    if (badLines !== -1) {
      setError(`page ${badLines}: OCR lines JSON is invalid: ${parsedLines[badLines]?.error ?? ""}`);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    // The page structure this request is being posted against. If it changes
    // while the request runs, the response's page indices describe pages that
    // no longer exist in that order — drop it rather than paint it.
    const revision = requestRevision.current;
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pages: pageInputs.map((page, index) => ({
            text: page.ocrText,
            lines: parsedLines[index]?.lines ?? [],
            imageDataUrl: page.sendImage ? page.image?.dataUrl : undefined,
          })),
        }),
      });
      const body: unknown = await response.json();
      if (requestRevision.current !== revision) return;
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : response.statusText;
        setError(message);
        return;
      }
      setResult(body as ExtractionResponse);
    } catch (err) {
      if (requestRevision.current !== revision) return;
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>receipt-evidence</h1>
      <p className="intro">
        Paste a receipt&apos;s OCR text (for example the contents of{" "}
        <code>packages/contract/test/fixtures/receipts/kr_01.txt</code>) and see what the parser and the model
        each contributed, and which of it was verified.
      </p>

      <form onSubmit={(event) => void handleSubmit(event)}>
        {pageInputs.map((page, pageIndex) => (
          <fieldset key={page.id} className="page-input">
            {/* Numbered from 0 because that is the number the results speak:
                every evidence reference below says "page N" in this same
                numbering, and a scan is one document read page 0 first. */}
            <legend>
              Page {pageIndex}
              {pageInputs.length > 1 && (
                <button type="button" className="remove-page" onClick={() => removePage(page.id)}>
                  remove
                </button>
              )}
            </legend>

            <label htmlFor={`ocr-text-${page.id}`}>OCR text</label>
            <textarea
              id={`ocr-text-${page.id}`}
              value={page.ocrText}
              onChange={(event) => updatePage(page.id, { ocrText: event.target.value })}
              rows={10}
              placeholder="paste this page's OCR text here"
            />

            <label htmlFor={`receipt-image-${page.id}`}>
              Receipt image (optional — the backdrop this page&apos;s evidence boxes are drawn on)
            </label>
            <input
              id={`receipt-image-${page.id}`}
              type="file"
              accept="image/*"
              onChange={(event) => void handleImageChange(page.id, event)}
            />

            <label htmlFor={`send-image-${page.id}`} className="checkbox">
              <input
                id={`send-image-${page.id}`}
                type="checkbox"
                checked={page.sendImage}
                disabled={page.image === null}
                onChange={(event) => updatePage(page.id, { sendImage: event.target.checked })}
              />
              Also send this page&apos;s photo to the model — the image fallback, for text too poor to read. Off
              by default: uploading it is the one thing here that sends your receipt&apos;s picture off this
              machine, and the app does it only for a page below the OCR floor.
            </label>

            <label htmlFor={`ocr-lines-${page.id}`}>
              OCR lines JSON (optional, advanced) — <code>{"[{ text, frame: {x,y,width,height} }]"}</code> in
              the image&apos;s own pixel space. Without this, evidence boxes cannot be anchored: /api/extract
              never runs OCR itself.
            </label>
            <textarea
              id={`ocr-lines-${page.id}`}
              value={page.linesText}
              onChange={(event) => updatePage(page.id, { linesText: event.target.value })}
              rows={3}
              placeholder="[]"
            />
            {parsedLines[pageIndex]?.error && <p className="form-error">{parsedLines[pageIndex]?.error}</p>}
          </fieldset>
        ))}

        <div className="form-actions">
          {/* The mobile scanner caps a scan at three pages; the demo mirrors
              that rather than inventing a second limit. */}
          {pageInputs.length < 3 && (
            <button type="button" onClick={addPage}>
              Add page
            </button>
          )}
          <button type="submit" disabled={loading}>
            {loading ? "Extracting…" : "Extract"}
          </button>
        </div>
      </form>

      {error && <p className="error-banner">{error}</p>}

      {result && (
        <div className="result">
          {result.modelReply.accepted === false && (
            <p className="rejection-banner">
              Model reply rejected — items and any model-derived field below come from the parser alone, not the
              model.
              <br />
              Reason: {result.modelReply.reason}
            </p>
          )}

          {/* One frame per page that has a photo, each painted only with ITS
              page's boxes (issue #2) — a box is anchored against one page's
              OCR geometry, and on any other image it would point the reader
              at unrelated text. */}
          {pageInputs.map((page, pageIndex) => {
            const { image } = page;
            if (image === null) return null;
            return (
              <div
                key={page.id}
                className="image-frame"
                style={{ aspectRatio: `${image.naturalWidth} / ${image.naturalHeight}` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, no remote loader needed */}
                <img src={image.dataUrl} alt={`uploaded receipt page ${pageIndex}`} />
                {boxes
                  .filter((entry) => entry.pageIndex === pageIndex)
                  .map((entry) => (
                    <div
                      key={entry.path}
                      className={entry.verified ? "box box-verified" : "box box-unverified"}
                      title={entry.path}
                      style={{
                        left: `${(entry.box.x / image.naturalWidth) * 100}%`,
                        top: `${(entry.box.y / image.naturalHeight) * 100}%`,
                        width: `${(entry.box.width / image.naturalWidth) * 100}%`,
                        height: `${(entry.box.height / image.naturalHeight) * 100}%`,
                      }}
                    />
                  ))}
              </div>
            );
          })}
          {pageInputs.some((page) => page.image !== null) && boxes.length === 0 && (
            <p className="hint">No evidence anchored to a line — supply OCR lines JSON above to see boxes.</p>
          )}

          <section className="fields">
            <h2>Fields</h2>
            <div className="field-row">
              <div className="field-head">
                <span className="field-label">currency</span>
                <span className="field-value">{result.fields.currency}</span>
                <SourceBadge source="parser" />
              </div>
            </div>
            <FieldRow label="merchant" field={result.fields.merchant} />
            <FieldRow label="purchase date" field={result.fields.purchaseDate} />
            <FieldRow label="paid total (minor units)" field={result.fields.paidTotal} />
            <FieldRow label="reference" field={result.fields.reference} />
          </section>

          <section className="items">
            <h2>Items ({result.items.length})</h2>
            {result.items.length === 0 && (
              <p className="hint">
                No items. The pipeline asks the model for items and takes none from the parser — the parser does
                derive them, but on this corpus it has never once derived a correct one (see the README table).
              </p>
            )}
            {result.items.map((item, index) => (
              <ItemRow key={index} item={item} />
            ))}
          </section>

          <section className="tenders">
            <h2>Additional tenders ({result.tenders.length})</h2>
            {result.tenders.length === 0 && <p className="hint">No additional tender payment was derived.</p>}
            {result.tenders.map((tender, index) => (
              <FieldRow key={index} label="additional tender (minor units)" field={tender} />
            ))}
          </section>

          <ArithmeticVerdict arithmetic={result.arithmetic} />

          {result.disagreements.length > 0 && (
            <section className="disagreements">
              <h2>Disagreements ({result.disagreements.length})</h2>
              <p className="hint">
                The parser re-read the model&apos;s own cited excerpt and got a different number.
              </p>
              <ul>
                {result.disagreements.map((d) => (
                  <li key={d.path}>
                    <code>{d.path}</code>: model said {d.modelValue}, parser reads {d.parserValue} from the same
                    excerpt
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.unverified.length > 0 && (
            <section className="unverified-summary">
              <h2>Unverified ({result.unverified.length})</h2>
              <ul>
                {result.unverified.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function ItemRow({ item }: { item: ExtractedItem }) {
  return (
    <div className="field-row">
      <div className="field-head">
        <span className="field-value">{item.name}</span>
        {item.quantity !== undefined && <span className="item-qty">×{item.quantity}</span>}
        <span className="field-value">{item.amountMinor}</span>
        <SourceBadge source={item.source} />
        <VerifiedBadge verified={item.verified} />
      </div>
      <Evidence pageIndex={item.nameEvidence.pageIndex} excerpt={item.nameEvidence.excerpt} />
      {!sameEvidence(item.nameEvidence, item.amountEvidence) && (
        <Evidence pageIndex={item.amountEvidence.pageIndex} excerpt={item.amountEvidence.excerpt} />
      )}
    </div>
  );
}
