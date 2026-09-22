<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Android build and device validation

BashKitten Android uses Fenix with this fork's Gecko engine and native C Tor.
Install only `bashkitten-arm64.apk`. Agent control and Tor are inside that APK;
the two probe APKs are independent developer test clients.

## Verified artifact

- Product source: `3035aa4ee383ca5b9b07ea62cdc811c4366f5656`.
- Browser SHA-256: `778bd419acc01a319688f3fd86d326c54aab32175aaf5e95f881594eb5fd516f`.
- [Signed APK and Pi extension artifacts](https://github.com/openresearchtools/wildbuzzard-android/actions/runs/35516040809).
- [Java and Kotlin compilation](https://github.com/openresearchtools/wildbuzzard-android/actions/runs/35518494795).
- Native engine source: `1a1f43b97113d9a2806f909cfe70e770645eeeca`.
- [Original complete native ARM64 build](https://github.com/openresearchtools/wildbuzzard-android/actions/runs/35464631299).

The artifact workflow verifies the original native APK hash and restricts reuse
to an explicit Android source allowlist. Its manifest records both revisions,
each APK hash, signing certificates and native library alignment. All downloaded
APK hashes and signatures were independently checked. The browser uses the
publisher certificate `2f6a2ceae1a80e98b3a12156d37e7dc5541ce0968dd48285bc71bb555713df38`; the separate
test clients retain their independent test signer.

All 19 native libraries are AArch64 with at least 16384-byte ELF load alignment.
They are compressed in the APK and extracted for loading. The APK contains
631 Android dependency license entries and the Mozilla,
BashKitten, BrowserOS, agent tools, C Tor, blocker and QR notices.

## Actual Pi use in Termux

Testing used real Android Termux with Node and unmodified Pi 0.85.1. An interactive
console loaded the installed extension through Pi's DefaultResourceLoader and
called its registered tools with a real Pi SessionManager and native read tool.
The installed extension, client and package metadata byte-matched the downloaded
Pi package artifact.
Codex chose each next operation from the returned page tree or image; this was
not a predetermined browsing sequence. No second AI/provider account was used.
ADB handled installation, native permission UI and independent inspection;
page commands and private file transfers ran as Termux's actual Android UID.

The current artifact was checked for automatic publisher authorization, the
external-vendor consent path, bounded arXiv result trees and referenced subtrees,
PDF viewer controls, actual PDF and RTF download/export, native Pi images and private
session files. The first-download StrictMode crash found during real use was
fixed by disabling Firefox's development violation logger and death penalties.
Those developer policies had remained enabled in the non-debuggable publisher APK.
The download-start check also now recognizes the running browser foreground
service, so an approved agent can accept downloads while its terminal stays
visible and before any browser activity is shown. Automatic default-browser
promotions were removed after one obscured the Tor toolbar during device checks;
the explicit default-browser setting remains available.

Earlier interactive passes also covered Python.org release navigation and an
833-byte signature download read through Pi; GNU.org navigation and a 76535-byte
AGPL RTF download read through Pi; desktop user-agent and adblocking switches
on individual tabs; scrolling, back/forward and closing one or all session tabs
without killing the browser. Google Scholar accepted the submitted search but
returned a network CAPTCHA. Successful Scholar result browsing is not claimed.

[Machine-readable evidence](validation-results.json) separates exact APK revisions,
live browsing phases, current checks and earlier UI checks. Pi screenshots and
downloaded files use unique names in that session's private directory, with
0700 directories and 0600 files. Native Pi read returned actual image content
for a saved PNG and text for the downloaded signature and RTF. No shared-storage
permission or companion browser-control APK was used.

## Authorization and device checks

Matching current publisher certificates are allowed automatically by default;
our Termux called tools without an explicit app grant or authorization command.
Other vendors use a persistent, revocable grant tied to package and signing
identity. Commands do not prompt individually. The deprecated development
signer is not automatically trusted through a signing-certificate lineage.
Terminal programs inherit their terminal app's identity.

A cold start from visible Termux is supported without an additional grant for
publisher-signed apps. In a separate test, force-stopping the browser while the
terminal was also in the background made Android block activity launch and freeze
the new browser process. The startup handshake now returns a bounded error in
that situation; bringing the terminal or browser forward allows recovery. This
is distinct from normal tab closure, which leaves the browser service running.

All four independent device suites passed on the recorded browser artifact.
The test-client source is `5f393d0d6843c52f64e5bf20118f3091fad40513` and its
separate APK hashes and signatures are recorded in the evidence. The first Tor
run stopped before import because its test driver clicked Android's DocumentsUI
drawer during translation. The probe now waits for the drawer and verifies the
Downloads directory before selecting the enrollment file. This test-only fix
does not change the browser APK.

The independent suites cover:

| Suite | Coverage |
| --- | --- |
| AgentBrowserTest | External-app API, owned tabs, DOM actions, storage isolation, blocking, cookie rejection, per-tab options and licenses |
| CommandBrowserTest | Browser-owned command entry point, grant/revocation, rendered screenshot and thumbnail pixels |
| AppCommandBrowserTest | Vendor app identity, session isolation, private screenshot/download transfer, missing/wrong tokens, Origin rejection and revocation |
| OnionBrowserTest | Complete auth-file import, scanner cancellation, saved-key restart, authenticated onion HTTPS and negative routing/TLS cases |

The live Tor fixture uses two private services accepting the same public key,
while only service A is enrolled. A loads and B fails, demonstrating site-specific
key use. Wrong certificate hostnames, unenrolled onion CAs, clearnet unknown CAs
and direct localhost access from Tor tabs are rejected. Saved encrypted keys
continue working after browser restart. Earlier checks of the same native TLS
code accepted renewed private-CA and self-signed leaves and rejected expired leaves.

## Diagnostics and limits

The artifact DEX audit found no Java/Kotlin Android Log output API references.
A harmless page-console marker appeared in the older APK's Android logs and
did not appear in the corrected APK. The final sampled logs contained no test
site URL output, StrictMode violations or AndroidRuntime crash output. Only
counts were retained for this check. Engine diagnostics reported remote DevTools,
Marionette, remote agent, WebDriver and engine accessibility disabled, using DOM
page trees. Tor starts with its daemon log destination disabled and uses its
private control socket for readiness.

Mozilla telemetry, Sync and crash uploads are disabled. Normal browser storage
and requested Pi output files remain part of the product. Android, graphics
drivers and native libraries can still emit system diagnostics; this is not a
claim that Android itself produces zero logs.

The test device is native ARM64 Cuttlefish, Android 17 / SDK 37, with actual
4096-byte kernel pages. A 16 KB-page kernel and physical foldable hardware have
not been tested. Earlier responsive UI checks changed the running window through
360, 800, 960 and 360 dp and retained its process, tabs and page. Scanner Close/Back
and full auth-file import were exercised through Android UI; QR parser checks
do not substitute for a physical camera scan.

## Reproduce the supplemental suites

The Java/Kotlin workflow also publishes independent test APKs with a
`probe-manifest.json`. To use those with an existing browser artifact, pass
`--probe-artifacts PROBE_DIRECTORY`; the report records the separate source and
hashes. Remove previously installed probe APKs if their test signing identity
differs. Never remove the browser for that test-client replacement.

Start the HTTP fixture in `bashkitten/android/tests/web` on port 8765 and
`bashkitten/android/tests/onion-fixture.py` with native Tor. Download the exact
recorded artifacts, then run:

```sh
python3 bashkitten/android/scripts/validate-device.py ARTIFACT_DIRECTORY \
  --probe-artifacts PROBE_DIRECTORY --serial DEVICE_SERIAL --output RESULTS_DIRECTORY \
  --onion-fixture PRIVATE_FIXTURE_JSON
```

The runner verifies artifact hashes and device architecture, installs the three
APKs, stages a complete enrollment file and records independent suite results.
Never commit generated fixture keys or caller tokens. Real Pi browsing remains
a separate interactive check, as described above.
