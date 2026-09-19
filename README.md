# WildBuzzard for Android

A Firefox/Fenix browser for Android with WildBuzzard's neutral light/dark theme,
native adblocking, cookie-banner rejection, external-app agent controls, and Tor
onion browsing. The normal Fenix browser interface remains; Mozilla accounts,
Sync, telemetry, experiments and promotional services are disabled.

This repository preserves the complete history of
[WildBuzzard's Android starting branch](https://github.com/openresearchtools/WildBuzzard/tree/refactor/browser-agent-independent)
at `0bd2d7da099a365d2243b320e1e6b38e8ad76cf4`.

- [Android build, architecture, licenses and device tests](wildbuzzard/android/README.md)
- [External-app agent API and AIDL integration](wildbuzzard/android/API.md)
- [ARM64 APK build workflow](https://github.com/openresearchtools/wildbuzzard-android/actions/workflows/android-arm64.yml)
- [Report WildBuzzard Android issues](https://github.com/openresearchtools/wildbuzzard-android/issues)

Agents can create and control their own tabs after user approval, bring the
browser forward, enable desktop mode or disable adblocking for an individual
tab, and close tabs without terminating the browser. DuckDuckGo is the default
search engine. Desktop torrents, bundled agent runtimes and WildBuzzard search
extensions are excluded from the Android product.

Onion credentials can be imported from TorKitten/Orbot QR codes, `.auth_private`
files, or manual address/key entry. Enrolled onion identities use Tor's native
authentication to permit private-CA HTTPS without installing that CA. Hostname,
expiry, other-onion and clearnet certificate checks remain in force.

The project is under development. GitHub Actions produces debug-signed,
`arm64-v8a` test APKs when the native engine and Android builds pass; a workflow
run is not evidence that device validation has passed. See the Android guide
for the Cuttlefish test procedures and current validation records.

## Source and notices

This is an independent fork, not a Mozilla product. The inherited source and
per-file licenses remain intact. Mozilla/Gecko notices are available in
`about:license`; the app's **Licenses and source** screen includes WildBuzzard,
BrowserOS, Mozilla DevTools MCP, Tor, blocker and Android dependency notices.
[Android provenance records](wildbuzzard/android/notices/sources.json) pin
external sources and notice hashes. The
[original Mozilla README](docs/readme/README.mozilla.md) is retained as upstream
reference. Please report product-specific issues in this repository.
