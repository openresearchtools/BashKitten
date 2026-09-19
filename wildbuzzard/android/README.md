<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# WildBuzzard for Android

Android product fork of `openresearchtools/WildBuzzard`, preserving the complete
ancestry of `refactor/browser-agent-independent` at
`0bd2d7da099a365d2243b320e1e6b38e8ad76cf4`.

The app uses the **Fenix interface and tab store**, Firefox's full Gecko engine,
and WildBuzzard's existing neutral light/dark palette and branding. Browser
navigation, bookmarks, history, downloads, local passwords, permissions,
reader view, private browsing and desktop-site controls remain Fenix features.
Mozilla accounts, Sync, telemetry, marketing, experiments, remote rollouts,
push integration and promotional service initialization are disabled. The
browser service HTTP client rejects Mozilla product endpoints; it does not
prevent users from visiting Mozilla websites. Bundled security data and Gecko's
sandbox, same-origin checks, certificate validation and content isolation remain.
DuckDuckGo is the default search engine. Desktop torrents, agent runtimes and
WildBuzzard search extensions are not Android runtime dependencies.
Android includes the desktop `99-wildbuzzard.js` policy directly. This also
disables vendor Safe Browsing lookups, remote certificate/blocklist updates and
Mozilla model downloads. The native blocker remains enabled; keeping Gecko and
its bundled security data current requires publishing updated WildBuzzard builds.

## Android app control

See [API.md](API.md). The AIDL contract lives in
`mobile/android/wildbuzzard-sdk/src/main/aidl`. External apps bind to the
explicit WildBuzzard service, obtain a user authorization PendingIntent, then
control their own tabs. Grants are tied to package names and signing
certificates. They can be revoked from **WildBuzzard tab controls**.

Tab closure removes a tab from Fenix. It never requests application shutdown,
force-stops a process, or stops Tor. Android can still reclaim or terminate an
app according to its normal process lifecycle. A foreground service keeps
user-authorized automation visible while it is active.

Desktop mode calls Fenix's existing per-tab desktop-site implementation.
Native adblocking can be toggled for one tab, with a reload; it does not create
a site-wide exception for other tabs. Both controls are available to agents.
Ordinary user tabs share website cookies and storage. Each approved agent app
gets its own shared website storage, so its login tabs can work together without
sharing another app's browsing session. Popups retain their opener's storage
context. Adblock exceptions use the individual Gecko browser ID, independent of
that storage context.

## Onion browsing

Tor is C Tor 0.4.9.12 from Guardian Project's checksum-pinned ARM64 binary. Its
Java service is built from the matching source revision. It uses a private
control socket and browser-owned lifetime. SOCKS requests resolve DNS through
Tor and use a separate circuit-isolation credential per Gecko session context.
There is no direct proxy fallback. WebRTC and WebTransport are disabled to
avoid transports outside this routing layer.
Switching an existing tab to Tor creates a fresh isolated Gecko session in that
same tab, dropping its previous direct-network page history and website storage.
Its subsequent popups inherit that Tor context. Closing one such popup does not
revoke the route or enrolled onion trust of its remaining sibling tabs.

Keys can be entered manually, imported from `.auth_private`, or scanned from
TorKitten's `http://<v3-address>.onion?key=<x25519-key>` QR. Keys are stored using
Android Keystore AES-GCM in app-private, backup-excluded storage and are sent
to Tor's in-memory client-auth registry. QR enrollment URLs are parsed locally;
they are never navigated or sent to a search engine.

For an enrolled v3 onion identity reached through that tab's Tor route, Gecko
accepts an unknown issuer or self-signed TLS certificate without a leaf-cert
exception or private-CA installation. Certificate hostname and validity checks
remain, including for renewals. This policy is ephemeral and keyed to the exact
GeckoView session origin attribute and onion identity. Clearnet HTTPS, other
onion identities and other tab contexts retain normal certificate validation.
TorKitten itself is unchanged. WildBuzzard does not claim Tor Browser's complete
fingerprinting/anonymity protections.

## Build and licenses

Use the root source tree and Mozilla's build wrapper:

```sh
export MOZCONFIG="$PWD/wildbuzzard/android/mozconfig"
./mach --no-interactive bootstrap --application-choice mobile_android
./mach build
./mach gradle :fenix:assembleDebug :wildbuzzard-agent-probe:assembleDebug :wildbuzzard-agent-probe:assembleDebugAndroidTest
python3 wildbuzzard/android/scripts/collect-artifacts.py artifacts
```

The **Android ARM64 APK** GitHub Actions workflow cross-compiles native Gecko
for `aarch64-linux-android` and builds installable APK artifacts. Debug artifacts
use Android debug signing and are test builds. Their manifest records source
revision and SHA-256 checksums. Build logs are retained even on failure.

Firefox's `about:license` remains available. **Licenses and source** includes
WildBuzzard, BrowserOS and Mozilla DevTools MCP provenance, Tor and linked
library notices, blocker notices and source links. Android dependency notices
use the same build-time OSS license generator as Fenix. Existing file licenses
and source history remain controlling. CLI notice output:

```sh
python3 wildbuzzard/android/scripts/notices.py --licenses
```

## Device validation

The separate **WildBuzzard Agent Probe** app uses the public Binder contract
under a different Android UID. Run it on a real ARM64 Android device or an
ARM64 Cuttlefish instance, with a local test server:

```sh
python3 -m http.server 8765 --directory wildbuzzard/android/tests/web
adb reverse tcp:8765 tcp:8765
adb install -r <browser.apk>
adb install -r <probe.apk>
```

Use the probe's access button, approve its package in WildBuzzard, then run its
lifecycle/page suite. Verify `adb shell getprop ro.product.cpu.abi` reports
`arm64-v8a`. Test records and actual build results are recorded separately;
this document describes the implementation and does not assert that an
unbuilt revision has passed device validation.

The recorded-build runner verifies APK checksums and native ARM64 device
architecture, installs all three APKs, runs the external-app instrumentation,
and saves test results, logcat and screenshots outside the checkout:

```sh
python3 wildbuzzard/android/scripts/validate-device.py /path/to/downloaded-artifacts \
  --serial 0.0.0.0:6520 --output /path/to/device-results \
  --onion-fixture /private/test-fixture/probe-fixture.json
```

Omit `--onion-fixture` for the browser/agent suite alone. After renewing or
expiring the live fixture certificate, add `--onion-only` and choose a new
output directory. This verifies the installed APK hashes and leaves the running
browser in place instead of reinstalling it. Reports record the device page
size; testing a 4 KB Cuttlefish instance does not establish 16 KB device support.

Tor listens on a filesystem socket inside the Android app sandbox. A process-owned SOCKS gateway requires a random in-memory credential before forwarding to that socket. The gateway retains its listening socket if Tor stops, so a different app cannot take over the browser's trusted endpoint. Imported keys are never exposed through an unauthenticated shared localhost Tor port.

Each restored or new managed tab blocks network traffic until its saved tab policy has been installed. Tor routing and adblock choice are stored per tab, and page-created child tabs inherit their parent's agent ownership and Tor requirement. The public Binder service and private foreground lifetime service are separate.

### Cuttlefish instrumentation and live Tor fixture

Install the probe instrumentation APK as well as the browser and probe APKs,
then run the separate-app lifecycle suite. The test handles the browser's
consent UI and records light/dark screenshots in the probe's external files.

```sh
adb install -r <probe-androidTest.apk>
adb shell am instrument -w -e class org.openresearchtools.wildbuzzard.probe.AgentBrowserTest org.openresearchtools.wildbuzzard.probe.test/androidx.test.runner.AndroidJUnitRunner
```

The optional live Tor test uses a locally generated private CA, a client-auth
onion, and an unenrolled public onion. Keep its directory outside the checkout:

```sh
python3 wildbuzzard/android/tests/onion-fixture.py --tor /path/to/tor --directory /private/test-fixture
adb reverse tcp:9443 tcp:9443
adb push /private/test-fixture/probe-fixture.json /sdcard/Android/data/org.openresearchtools.wildbuzzard.probe/files/probe-fixture.json
adb shell am instrument -w -e class org.openresearchtools.wildbuzzard.probe.OnionBrowserTest org.openresearchtools.wildbuzzard.probe.test/androidx.test.runner.AndroidJUnitRunner
```

Never commit the generated credential file. Send `SIGHUP` to the fixture's Python
process and rerun the test to verify a renewed leaf under the persistent CA.
Send `SIGUSR1` and repush its fixture JSON to test certificate expiry. These
signals preserve the running Tor service and onion identity. `--expired` is
also available when starting the fixture.
The suite also checks unenrolled onions, hostname mismatches, clearnet private-CA
rejection, and blocked localhost access from a Tor tab. These are test procedures,
not claims that device validation has already passed.
