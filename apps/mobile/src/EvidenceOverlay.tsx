// Draws the captured receipt with a box over every OCR line an extracted
// value was anchored to. The point of the whole app is that a value is
// shown next to the pixels it was read from, so this is not decoration:
// a value whose box is missing is a value the reader cannot check.
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import type { Frame } from "@receipt-evidence/contract/response";
import { scaleFrame } from "./capture.ts";

export interface EvidenceOverlayProps {
  /** The captured JPEG: its `uri` plus the pixel size `frame` is expressed in. */
  image: { uri: string; width: number; height: number };
  /** Anchored boxes, in the image's own pixel space. */
  boxes: readonly Frame[];
  /** Boxes belonging to a value that failed its guard, drawn in the warning
   * colour so an unverified claim is visibly different rather than quietly
   * shown as fact. */
  unverifiedBoxes: readonly Frame[];
}

/** A Frame is domain geometry (x/y); an absolutely positioned View wants
 * left/top. Keeping the conversion here leaves `scaleFrame` a plain
 * coordinate transform that `node --test` can exercise without React Native. */
function position(frame: Frame, imageWidth: number, renderedWidth: number) {
  const { x, y, width, height } = scaleFrame(frame, imageWidth, renderedWidth);
  return { left: x, top: y, width, height };
}

export function EvidenceOverlay({ image, boxes, unverifiedBoxes }: EvidenceOverlayProps) {
  // Measured, never assumed: the same receipt renders at a different width
  // on every device, and a hard-coded ratio puts every box in the wrong place.
  const [renderedWidth, setRenderedWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setRenderedWidth(event.nativeEvent.layout.width);
  const aspectRatio = image.height > 0 ? image.width / image.height : 1;

  return (
    <View onLayout={onLayout} style={styles.container}>
      <Image source={{ uri: image.uri }} style={[styles.image, { aspectRatio }]} resizeMode="contain" />
      {boxes.map((box, index) => (
        <View key={`verified-${index}`} style={[styles.box, position(box, image.width, renderedWidth)]} />
      ))}
      {unverifiedBoxes.map((box, index) => (
        <View
          key={`unverified-${index}`}
          style={[styles.box, styles.unverified, position(box, image.width, renderedWidth)]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "relative", width: "100%" },
  image: { width: "100%" },
  box: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#1d7a46",
    backgroundColor: "rgba(29, 122, 70, 0.12)",
  },
  unverified: { borderColor: "#b3261e", backgroundColor: "rgba(179, 38, 30, 0.16)" },
});
