<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Android build and device validation

The tested browser is the Fenix product with this fork's Gecko engine and native
C Tor. Only `wildbuzzard-arm64-debug.apk` is needed for normal use or agent control.
The probe APKs are independent developer test clients.

## Build provenance

- Product/test source: `677332e1b326703a76f802c7e0e844c9a0e0aa6e`.
- Browser APK SHA-256: `956c7e391ed9596ba29cbea73f3f2a8dc0c3f813bdb33162c59929398a3e85f9`.
- APK workflow: https://github.com/openresearchtools/wildbuzzard-android/actions/runs/35476947904
- Native engine source: `1a1f43b97113d9a2806f909cfe70e770645eeeca`.
- Original full native build: https://github.com/openresearchtools/wildbuzzard-android/actions/runs/35464631299

The UI workflow verifies the original native APK checksum and permits reuse only
when changes stay within its Android source allowlist. The artifact manifest
records both revisions, each APK checksum, native library architecture and ELF
alignment, and signing certificate. These are development builds signed with a
persistent CI development certificate, not production release builds. Local
verification of all three downloaded APK signatures and checksums also passed.
The browser packages 647 Android dependency license entries plus the Mozilla,
Wild Buzzard, BrowserOS, Tor, blocker and QR notices.

Development certificate SHA-256:
`dd4e34d1e0541a7686093b89346514934eae208fbb13496d8bb249dc72dfebc7`.

## Device

ARM64 Cuttlefish, `aosp_cf_arm64_only_phone`, Android 17 / SDK 37, actual page size
4096 bytes. All 19 packaged native libraries have AArch64 ELF headers and at least
16384-byte load-segment alignment. They are compressed in the APK and extracted
for loading. A device running a 16 KB-page kernel has not been tested.

Responsive layout testing changes the same running Android window between
360 dp, 800 dp, 960 dp and 360 dp. This exercises phone, unfolded-width, tablet
landscape and folded-width behavior; it is not a physical foldable hardware test.

## Device checks

The final APK passed all three instrumentation suites on 20 September 2026.
[Machine-readable results](validation-results.json) record the exact source,
APK hashes, device details, update preservation and additional UI checks.

| Final APK check | Result |
| --- | --- |
| External-app agent control, tab lifecycle and ownership, DOM operations, storage isolation and restart policies | Passed |
| Native blocking, cookie rejection, per-tab desktop/adblock controls and license UI | Passed |
| Browser-owned CLI, one-time grant, rendered screenshot and thumbnail pixels, tab isolation and revocation | Passed |
| Full auth-file import, scanner Close/Back, saved-key restart, authenticated onion HTTPS and negative routing/TLS cases | Passed |
| In-place APK update preserves encrypted onion credentials | Passed |
| APK hashes/signatures, native architecture/alignment and offline notices | Passed |

Additional UI checks passed on
`399d8e49943dd206d6a1b920151030e3eda360f5`, immediately before the final
agent-screenshot tab-identity guard. The UI implementation is unchanged in the
latest APK:

| Check | Result |
| --- | --- |
| Normal-menu desktop-site and adblocking checkboxes, selected-tab isolation | Passed |
| 360 → 800 → 960 → 360 dp layout transitions, preserving process, page and tab IDs | Passed |
| Normal / Private / Tor tray, saved onion quick access and rendered Tor thumbnail | Passed |

The complete app, CLI and onion instrumentation suites were rerun and passed
for the final APK. A screenshot is discarded if its selected tab or Gecko session changes
while capture is in progress. Saved Tor credentials are restored after enabling
Tor networking, which otherwise resets Tor's in-memory authentication map.

Live Tor tests use generated local fixtures. Two private services accept the
same public authentication key, but only service A is enrolled in the browser.
The tests require A to load and B to fail. They also reject wrong certificate
hostnames, unenrolled onion CAs, clearnet unknown CAs and direct localhost access
from Tor tabs. The restart check loads A without re-importing its encrypted key.

Earlier checks on the same native TLS implementation additionally accepted a
renewed private-CA leaf and a genuinely self-signed leaf, and rejected an expired
leaf. Actual Termux 0.118.3 executed the browser APK's command entry point on
source `3b23e23805911ab42e763277f8acb7e9f6d0102a`: real DOM access, per-tab desktop
mode, opening the browser, closing individual tabs, and a persistent private
command key all passed. The existing Termux/BashKitten process was preserved.

Scanner cancellation and complete `.auth_private` import are exercised through
the Android UI. QR credential parsing has separate parser checks; a physical
camera scan is not claimed by these emulator results.

## Authorization

Current app and shell interfaces use persistent one-time grants. Individual
commands do not require repeated approval. Same-signing-certificate automatic
authorization was discussed but is not implemented. The CLI grant remains
separate from Android package/certificate identity.

## Reproduce

Start the HTTP fixture from `wildbuzzard/android/tests/web` on port 8765, run
`wildbuzzard/android/tests/onion-fixture.py` with native Tor, and download the
recorded build artifacts. Run:

```sh
python3 wildbuzzard/android/scripts/validate-device.py ARTIFACT_DIRECTORY \
  --serial DEVICE_SERIAL --output RESULTS_DIRECTORY \
  --onion-fixture PRIVATE_FIXTURE_JSON
```

The runner verifies artifact hashes and native device architecture, installs
updates, stages a complete enrollment file, runs independent app/CLI/Tor suites,
and retains results, logs and screenshots. Never commit generated fixture keys.
