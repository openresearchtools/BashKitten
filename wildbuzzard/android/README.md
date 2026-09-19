<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Wild Buzzard for Android

**Install `wildbuzzard-arm64-debug.apk` only.** It includes the browser, agent
control and Tor. The two probe APKs in developer artifacts are optional test
tools; users and agents do not need a companion app.

Android product fork of `openresearchtools/WildBuzzard`, preserving the complete
ancestry of `refactor/browser-agent-independent` at
`0bd2d7da099a365d2243b320e1e6b38e8ad76cf4`.

The app uses the **Fenix interface and tab store**, Firefox's full Gecko engine,
and Wild Buzzard's existing neutral light/dark palette and branding. Browser
navigation, bookmarks, history, downloads, local passwords, permissions,
reader view, private browsing and desktop-site controls remain Fenix features.
Mozilla accounts, Sync, telemetry, marketing, experiments, remote rollouts,
push integration and promotional service initialization are disabled. The
browser service HTTP client rejects Mozilla product endpoints; it does not
prevent users from visiting Mozilla websites. Bundled security data and Gecko's
sandbox, same-origin checks, certificate validation and content isolation remain.
DuckDuckGo is the default search engine. Desktop torrents, agent runtimes and
Wild Buzzard search extensions are not Android runtime dependencies.
Android includes the desktop `99-wildbuzzard.js` policy directly. This also
disables vendor Safe Browsing lookups, remote certificate/blocklist updates and
Mozilla model downloads. The native blocker remains enabled; keeping Gecko and
its bundled security data current requires publishing updated Wild Buzzard builds.

## Android app control

Terminal programs can also call the command entry point included in the browser
APK. [API.md](API.md#termux-and-shell-programs) documents the Termux shell function,
one-time consent, JSON input/output and commands. Android app binding and shell
commands both use the browser's own dispatcher and tab ownership checks.

See [API.md](API.md). The AIDL contract lives in
`mobile/android/wildbuzzard-sdk/src/main/aidl`. External apps bind to the
explicit Wild Buzzard service, obtain a user authorization PendingIntent, then
control their own tabs. Grants are tied to package names and signing
certificates. They can be revoked from **Settings → Revoke agent access**.

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

The tab tray has Normal, Private and Tor pages. Non-private Tor sessions stay out
of Normal; onion pages opened privately retain private storage and the private
lock. The normal menu contains checkbox controls for Desktop site and per-tab
adblocking. Licenses and agent-access revocation live in Settings. Seeded top
sites, Firefox icon customization, wallpapers, the Longfox game and tab-group
promotions are disabled. User-created shortcuts and history are preserved.

The toolbar follows the activity's current window width. At 600 dp or wider it
shows the tab bar by default; narrowing the window hides it. Folding, unfolding,
rotation and split-screen changes rebind the toolbar and viewport while keeping
browser sessions in the application store. The customization switch controls
the wide-window tab bar, without forcing it onto a narrow phone window.

## Onion browsing

Open the tab tray, select **Tor**, then **Private Tor sites** to scan a credential QR
or choose a complete `.auth_private` file. Give the site an optional name and
save it; **Add to quick access** is checked by default. Saved sites have Open,
Quick access and Remove actions. These screens have a toolbar Back button, and the
scanner has a visible Close button as well as Android Back support.

Typing, following a link, opening a bookmark, or using the agent `navigate`
command with an `.onion` address automatically prepares its tab for Tor. There
is no manual Tor switch to enable first. Quick-access entries and bookmarks store only the HTTPS address
and title; the site-specific key remains in the encrypted credential store.

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
to Tor's in-memory client-auth registry under the exact 56-character onion
service ID. A key is never tried on a different onion service. The same binding
is restored after browser restart. QR enrollment URLs are parsed locally;
they are never navigated or sent to a search engine.
The QR and `.auth_private` options are first in the enrollment screen. Both
extract the complete address/key pair; manual fields are an optional fallback.
Imported sites can be opened from this screen or from home-page quick access or the Tor tray,
without retyping the address or key.

For an enrolled v3 onion identity reached through that tab's Tor route, Gecko
accepts an unknown issuer or self-signed TLS certificate without a leaf-cert
exception or private-CA installation. Certificate hostname and validity checks
remain, including for renewals. This policy is ephemeral and keyed to the exact
GeckoView session origin attribute and onion identity. Clearnet HTTPS, other
onion identities and other tab contexts retain normal certificate validation.
TorKitten itself is unchanged. Wild Buzzard does not claim Tor Browser's complete
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
Repository builds use the explicit `WILDBUZZARD_CI_DEBUG_KEYSTORE` Actions secret
so updates retain their signing identity. Artifact collection verifies every APK
against that certificate and records its fingerprint. Pull requests without
access to the secret use an ephemeral test identity. Local builds can set
`WILDBUZZARD_DEBUG_KEYSTORE` to a debug keystore with the standard `android`
password and `androiddebugkey` alias. These identities are for development;
production APKs require the publisher's production signing configuration.

Firefox's `about:license` remains available. **Licenses and source** includes
Wild Buzzard, BrowserOS and Mozilla DevTools MCP provenance, Tor and linked
library notices, blocker notices and source links in separate labeled buttons.
The complete offline bundle is also available from **All notices and source links**.
Android dependency notices
use the same build-time OSS license generator as Fenix. Existing file licenses
and source history remain controlling. CLI notice output:

```sh
python3 wildbuzzard/android/scripts/notices.py --licenses
```

## Device validation

The separate **Wild Buzzard Agent Probe** app uses the public Binder contract
under a different Android UID. Run it on a real ARM64 Android device or an
ARM64 Cuttlefish instance, with a local test server:

```sh
python3 -m http.server 8765 --directory wildbuzzard/android/tests/web
adb reverse tcp:8765 tcp:8765
adb install -r <browser.apk>
adb install -r <probe.apk>
```

Use the probe's access button, approve its package in Wild Buzzard, then run its
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
adb push /private/test-fixture/fixture.auth_private /sdcard/Download/fixture.auth_private
adb shell am instrument -w -e credentialFile fixture.auth_private -e class org.openresearchtools.wildbuzzard.probe.OnionBrowserTest org.openresearchtools.wildbuzzard.probe.test/androidx.test.runner.AndroidJUnitRunner
adb shell rm /sdcard/Download/fixture.auth_private
```

Never commit the generated credential file. Send `SIGHUP` to the fixture's Python
process and rerun the test to verify a renewed leaf under the persistent CA.
Send `SIGUSR1` and repush its fixture JSON to test certificate expiry. These
signals preserve the running Tor service and onion identity. `--expired` is
also available when starting the fixture.
Send `SIGUSR2` to test a self-signed leaf, or start with `--self-signed-leaf`.
`SIGHUP` returns to a valid leaf signed by the original persistent private CA.
The suite also checks a second private onion that could accept the same key but
has not been enrolled: it must fail before TLS because that key is not tried.
It checks unenrolled public onions, hostname mismatches, clearnet private-CA
rejection, and blocked localhost access from a Tor tab. These are test procedures,
not claims that device validation has already passed.
It first checks both scanner cancellation controls, then imports the complete
generated `.auth_private` through Android's document picker. The recorded-build
runner stages that test credential with a unique filename and removes it after
the suite. Use only generated test credentials with the device test runner.

### Android UI builds with a verified native engine

The manually dispatched **Android UI APK with verified engine** workflow accepts
a successful full ARM64 build run ID from this repository. It checks the recorded
APK hash and rejects source changes outside an explicit Android UI/control
allowlist before using Mozilla's artifact-build support with those native Gecko
binaries. It builds the current Java/Kotlin UI and engine resources, retains the
full-build workflow, verifies APK signing, and records the native engine source
and input APK hash in `build-manifest.json`. Native or engine-interface changes
require a new full ARM64 build.
