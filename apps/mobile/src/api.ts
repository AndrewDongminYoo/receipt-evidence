// Where the app sends its extraction request.
//
// This defaulted to `http://localhost:3000`, which cannot work on the one
// device the app exists for: a phone's localhost is the phone. The only
// escape provided was `EXPO_PUBLIC_API_URL`, and that made it worse rather
// than better — `EXPO_PUBLIC_*` is substituted into the source by
// babel-preset-expo's inline-env-vars plugin during Metro's transform, so
// the value has to be in METRO's environment. Setting it on the
// `expo run:ios` command, which is what the README used to say, reaches the
// build and never the bundle whenever a dev server is already running (and
// `expo run:ios` prints "Skipping dev server" in exactly that case).
//
// So the default follows the dev server the app is already talking to — an
// address that is, by construction, one this device can reach.
//
// WHICH source supplies it matters, and the first choice was wrong. Measured
// on a real iPhone: `Constants.expoConfig?.hostUri` is undefined in this app,
// so it fell through to localhost and the screen said so. The reason is in
// expo-constants' own `Constants.js`: `expoConfig` reads the native manifest,
// which is written by the dev launcher (`expo-dev-client`) or `expo-updates`.
// This app installs neither, so the manifest is empty and `expoConfig` is
// null — the manifest Metro serves over HTTP, which does carry `hostUri`, is
// never the one `expo-constants` reads.
//
// React Native's `SourceCode.scriptURL` is the bundle URL the app actually
// booted from. It is the one value whose presence is not an assumption: the
// app is running, so a bundle came from somewhere. In a release build it is a
// `file://` URL, which yields no host and falls back correctly.
const API_PORT = 3000;

/**
 * @param configured `process.env.EXPO_PUBLIC_API_URL`, inlined at bundle time.
 * @param devServerUrl anything carrying the dev server's host — a bare
 *   `host:port`, or a full bundle URL. Absent in a production build.
 */
export function apiBaseUrl(configured: string | undefined, devServerUrl: string | undefined): string {
  const explicit = configured?.trim();
  if (explicit !== undefined && explicit !== "") return explicit.replace(/\/+$/, "");
  const host = devServerHost(devServerUrl);
  return `http://${host ?? "localhost"}:${API_PORT}`;
}

function devServerHost(devServerUrl: string | undefined): string | null {
  if (devServerUrl === undefined || devServerUrl.trim() === "") return null;
  const authority = devServerUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? "";
  // An IPv6 literal keeps its brackets, and its colons are not a port separator.
  const host = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : (authority.split(":")[0] ?? "");
  return host === "" ? null : host;
}
