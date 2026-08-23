// The capture path this sample is actually about: scan a receipt, decide
// per page whether its text can travel alone, post one request, and show
// every extracted value beside the pixels it was read from.
import { useState } from "react";
import { ActivityIndicator, Button, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { File } from "expo-file-system";
import { scan, DEFAULT_OCR_FLOOR } from "react-native-receipt-scanner";
import type { ReceiptImage } from "react-native-receipt-scanner";
import type { ExtractedField, ExtractedItem, ExtractionResponse, Frame, Page } from "@receipt-evidence/contract/response";
import { apiBaseUrl } from "./src/api.ts";
import { clearsFloor } from "./src/capture.ts";
import { EvidenceOverlay } from "./src/EvidenceOverlay.tsx";

// Derived from the dev server this bundle came from, so it points at the
// machine running `pnpm --filter web dev` without being configured. See
// src/api.ts for why the env var alone was not enough.
const API_URL = apiBaseUrl(process.env.EXPO_PUBLIC_API_URL, Constants.expoConfig?.hostUri);

/** The page whose photo the result view shows. Every other page's values are
 * still listed — only their boxes have nowhere to be drawn. */
const PRIMARY_PAGE = 0;

type Status =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "failed"; message: string }
  | { kind: "done"; image: ReceiptImage; result: ExtractionResponse };

/** Turns one capture into a request page. Text always; the JPEG only when
 * the text cannot carry the work — that decision, not the upload, is what
 * the OCR floor is for. */
async function toPage(image: ReceiptImage): Promise<Page> {
  const page: Page = { text: image.ocrText ?? "", lines: image.ocrLines ?? [] };
  if (clearsFloor(image.ocrQuality, DEFAULT_OCR_FLOOR)) return page;
  const base64 = await new File(image.uri).base64();
  // mimeType is always "image/jpeg" on this package, but reading it from the
  // capture keeps the media type travelling with the bytes instead of being
  // asserted here — the server hands the whole data URL straight to the model.
  return { ...page, imageDataUrl: `data:${image.mimeType};base64,${base64}` };
}

/** Boxes for ONE page, in that page's own pixel space.
 *
 * The pageIndex filter is not optional: a scan may carry up to three pages,
 * each anchored against its own OCR geometry, and the view shows one photo.
 * Without it a box computed on page 1 was painted on page 0's image, pointing
 * the reader at unrelated text — the worst failure available to an app whose
 * claim is that a value is shown beside the pixels it was read from. */
function boxesOf(result: ExtractionResponse, pageIndex: number, wanted: boolean): Frame[] {
  const entries = [
    ...Object.values(result.fields).filter(
      (field): field is ExtractedField<string> | ExtractedField<number> =>
        typeof field === "object" && field !== null,
    ),
    ...result.items,
  ];
  return entries
    .filter(
      (entry) =>
        entry.evidence.pageIndex === pageIndex && entry.verified === wanted && entry.evidence.box !== null,
    )
    .map((entry) => entry.evidence.box as Frame);
}

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function capture(source: "camera" | "gallery") {
    try {
      setStatus({ kind: "working", step: "scanning" });
      const scanned = await scan({
        source,
        maxPages: 3,
        // Geometry is off by default, and without it there is nothing to draw
        // a box from. The floor is disabled here on purpose: the package's own
        // gate DROPS a below-floor capture into `rejectedImages`, and that is
        // exactly the capture whose image most needs to be sent. This app
        // keeps every page and decides per page what it carries (`toPage`).
        ocrGeometry: true,
        ocrFloor: false,
      });
      if (scanned.status === "cancelled") return setStatus({ kind: "idle" });
      const [primary] = scanned.images;
      if (primary === undefined) {
        return setStatus({ kind: "failed", message: "the scanner returned no page" });
      }

      setStatus({ kind: "working", step: "extracting" });
      const pages = await Promise.all(scanned.images.map(toPage));
      const response = await fetch(`${API_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : response.statusText;
        return setStatus({ kind: "failed", message });
      }
      setStatus({ kind: "done", image: primary, result: body as ExtractionResponse });
    } catch (error) {
      setStatus({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <StatusBar style="dark" />
      <Text style={styles.title}>Receipt Evidence</Text>
      <Text style={styles.muted}>{API_URL}</Text>
      <View style={styles.actions}>
        <Button title="Scan" onPress={() => void capture("camera")} disabled={status.kind === "working"} />
        <Button title="Pick" onPress={() => void capture("gallery")} disabled={status.kind === "working"} />
      </View>

      {status.kind === "working" && (
        <View style={styles.row}>
          <ActivityIndicator />
          <Text style={styles.muted}>{status.step}…</Text>
        </View>
      )}
      {status.kind === "failed" && (
        <View>
          <Text style={styles.failed}>{status.message}</Text>
          {/* The address, always, on the failure that names it least. "Could
              not connect to the server" is the same sentence whether the API
              is down, the phone is on another network, or the app resolved a
              host it can never reach — and without the URL each of those
              costs a round trip to tell apart. */}
          <Text style={styles.muted}>posting to {API_URL}/api/extract</Text>
        </View>
      )}
      {status.kind === "done" && <Result image={status.image} result={status.result} />}
    </ScrollView>
  );
}

function Result({ image, result }: { image: ReceiptImage; result: ExtractionResponse }) {
  const { fields, items, arithmetic, unverified, disagreements, modelReply } = result;
  return (
    <View style={styles.result}>
      {image.ocrLines === undefined ? (
        <Image source={{ uri: image.uri }} style={styles.plainImage} resizeMode="contain" />
      ) : (
        // `image` is scanned.images[0], so only page 0's boxes belong on it.
        <EvidenceOverlay
          image={image}
          boxes={boxesOf(result, PRIMARY_PAGE, true)}
          unverifiedBoxes={boxesOf(result, PRIMARY_PAGE, false)}
        />
      )}

      <FieldRow label="Merchant" field={fields.merchant} />
      <FieldRow label="Date" field={fields.purchaseDate} />
      <FieldRow label="Paid total" field={fields.paidTotal} />
      <FieldRow label="Reference" field={fields.reference} />
      <Text style={styles.muted}>Currency: {fields.currency} (parser)</Text>

      <Text style={styles.heading}>Items</Text>
      {items.length === 0 && <Text style={styles.muted}>none reported</Text>}
      {items.map((item: ExtractedItem, index: number) => (
        <View key={index} style={styles.entry}>
          <Text style={item.verified ? styles.value : styles.unverifiedValue}>
            {item.name} — {item.amountMinor}
            {item.verified ? "" : "  ⚠ unverified"}
          </Text>
          <Text style={styles.evidence}>“{item.evidence.excerpt}”</Text>
        </View>
      ))}

      <Text style={styles.heading}>Checks</Text>
      <Text style={styles.muted}>
        {/* `agrees: null` is a third state — nothing to compare — and is shown
            as itself rather than folded into a failure. */}
        Arithmetic:{" "}
        {arithmetic.agrees === null
          ? "not computable (no items or no total)"
          : arithmetic.agrees
            ? `items sum to the total (${arithmetic.itemSumMinor})`
            : `items sum to ${arithmetic.itemSumMinor}, total says ${arithmetic.claimedTotalMinor}`}
      </Text>
      {unverified.length > 0 && <Text style={styles.failed}>Unverified: {unverified.join(", ")}</Text>}
      {disagreements.map((disagreement, index) => (
        <Text key={index} style={styles.failed}>
          {disagreement.path}: parser read {disagreement.parserValue}, model said {disagreement.modelValue}
        </Text>
      ))}
      {!modelReply.accepted && <Text style={styles.failed}>Model reply rejected: {modelReply.reason}</Text>}
    </View>
  );
}

function FieldRow({ label, field }: { label: string; field?: ExtractedField<string> | ExtractedField<number> }) {
  if (field === undefined) return <Text style={styles.muted}>{label}: not derived</Text>;
  return (
    <View style={styles.entry}>
      <Text style={field.verified ? styles.value : styles.unverifiedValue}>
        {label}: {String(field.value)} ({field.source}){field.verified ? "" : "  ⚠ unverified"}
      </Text>
      <Text style={styles.evidence}>“{field.evidence.excerpt}”</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingTop: 64, gap: 12 },
  title: { fontSize: 22, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  result: { gap: 8 },
  plainImage: { width: "100%", height: 320 },
  heading: { fontSize: 16, fontWeight: "600", marginTop: 12 },
  entry: { gap: 2 },
  value: { fontSize: 15 },
  unverifiedValue: { fontSize: 15, color: "#b3261e" },
  evidence: { fontSize: 12, color: "#555", fontStyle: "italic" },
  muted: { fontSize: 13, color: "#555" },
  failed: { fontSize: 13, color: "#b3261e" },
});
