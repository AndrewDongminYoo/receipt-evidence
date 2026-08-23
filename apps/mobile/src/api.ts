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
// So the default now follows the dev server the app is already talking to.
// `Constants.expoConfig.hostUri` is the Metro address this bundle was loaded
// from, which makes it, by construction, an address this device can reach.
const API_PORT = 3000;

/**
 * @param configured `process.env.EXPO_PUBLIC_API_URL`, inlined at bundle time.
 * @param hostUri `Constants.expoConfig?.hostUri` — `host:port`, sometimes with
 *   a scheme or a trailing path, and absent in a production build.
 */
export function apiBaseUrl(configured: string | undefined, hostUri: string | undefined): string {
  const explicit = configured?.trim();
  if (explicit !== undefined && explicit !== "") return explicit.replace(/\/+$/, "");
  const host = devServerHost(hostUri);
  return `http://${host ?? "localhost"}:${API_PORT}`;
}

function devServerHost(hostUri: string | undefined): string | null {
  if (hostUri === undefined || hostUri.trim() === "") return null;
  const authority = hostUri.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? "";
  // An IPv6 literal keeps its brackets, and its colons are not a port separator.
  const host = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : (authority.split(":")[0] ?? "");
  return host === "" ? null : host;
}
