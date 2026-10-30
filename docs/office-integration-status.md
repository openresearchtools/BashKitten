# Files, Office and References status — 28 October 2026

Requirements are in [the integration plan](files-office-bibliography-plan.md).
This record separates research/temporary comparison evidence from implementation
and installed-product acceptance. Historical checkpoints below retain the limits
and failures of their original candidates; the current result is recorded first.

## ESR 153.6 refresh before publication — 30 October 2026

The user added a current upstream/security refresh before publishing the next
candidate. Firefox ESR 153.6.0 is merged through the existing compact source
history, retaining the product adaptations and the four installed corrections
below. The matching released Tor Browser 16.0 lineage contributes six additional
production commits, including Android download filename validation; all fifteen
previous backports remain. Exact source commits and applicability are recorded in
`browser/bashkitten/upstreams.toml` and `UPDATING-FIREFOX.md`. The browser's
version/history and regenerated full-license checks pass. The normal prepare run
[41079252949](https://github.com/openresearchtools/BashKitten/actions/runs/41079252949)
created candidate `1a8b9b8b99e2104a3e0dd2bca5bd4745b322d67d`, version 153.6.
Its combined build
[41079559761](https://github.com/openresearchtools/BashKitten/actions/runs/41079559761)
has passed all eight native Office/Files jobs, both Termux assemblies and normal
corresponding-source collection. Browser compilation, the complete-candidate gate
and installed acceptance remain pending; publication is held.

Native Tor 0.4.9.15 and Valkey 9.1.3 sources and build pins are updated. Both APK
architectures built Tor 0.4.9.15 with the retained Guardian JNI API and passed the
existing staging, export, static-dependency, 16 KB alignment and binary/provenance
checks. The released expert-bundle daemon is not a compatible JNI replacement.
The same batch updates Node to 24.22.2 on Linux and 24.22.1 on Termux, c-ares to
1.34.9, Files MuPDF to 1.28.6, DDGS to 9.16.1 and certifi to 2026.10.23. All eight
Node/Search runtime and source assemblies passed. MuPDF's existing notice
collector now includes the complete FreeType license texts from its source.
Office retains its paired Collabora release and refreshes OpenSSL 3.5.9, curl
8.23.0, Python 3.14.10, Poco 1.15.4, HarfBuzz 14.6.0, ICU/data 78.3 and SQLite
3.54.1. Its 121 original archives, Linux/Termux patch sequences and native Python
package paths verify; all four native Office and four Files builds passed in
the combined pipeline. Authelia, Caddy, Podman and its selected helper releases were
already current at this review. Original source
archives remain outside Git and are included in normal corresponding-source
artifacts with full notices.

Preflight corrected two stale retained-Termux inventory lock hashes exposed by
automatic auth CI, without changing its original archives. The shared source
collector also accepts new native archive pins without obsolete split-part
paths; it reads all 5,443 current records, including MuPDF and both Tor owners.
Both Android daughter workflows match the reviewed canonical workflow. These
source/build-input checks do not establish final APK or installed acceptance.

The Android ARM64 producer's first attempt failed on GitHub HTTP 502 while
reading prior-job metadata, before compilation. The same-source retry passed
that step and its new native Tor build and is compiling Gecko. The failed parent
collector still needs its normal retry after the remaining jobs finish; this is
not recorded as a complete pipeline pass. The verified x86_64 Termux package
retains readable/traversable Files modules and an executable `bashkitten-x11`.
Build identities, recovery actions and package receipts are retained under
`Bashkitten-Acceptance/candidates/153.6-1a8b9b8b99e2/` outside the repository.

A fresh Termux:X11 review found the embedded source, browser adapter and loader
already match the current official `6dfb8b4a4cc887bc329284d31eb049d596bd1208`
release/nightly. The earlier actual phone Display launch is evidence for that
pair, not for the pending ESR 153.6 APK. Termux app update checks remain on the
official stable channel; the prerelease option is only for BashKitten and its
matching packages. The unpublished 153.5.5 candidate is retained as historical
build/installed evidence, not the next publication target.

## 153.5.5 regression work — 30 October 2026

The first full 153.5.5 candidate, `cf0e0a133fc150e529c5f895c864c1fc7ef681ad`,
passed all 62 jobs in
[41054415200](https://github.com/openresearchtools/BashKitten/actions/runs/41054415200),
including six primary packages, all eight Office/Files components and the normal
source/legal gate. Publication is held for the focused installed findings below;
build success does not establish their correction.

The installed phone passed sidecar PDF download through the native browser
prompt, Downloads, Android Open with, local PDF rendering and Share sheet. The
downloaded bytes matched, and the custom completion row was absent. Its visible
tab group order was Agent, Files, normal, private and Tor. Installed Wayland and
real Xorg checks passed Files/Office use, native desktop downloads, Hide Agent/logo
behavior and resizing. Xorg also passed normal cold startup (Files running about
2.6 seconds after Local started, before a Files click) and the actual 600-pixel
narrow layout. Wayland's isolated namespace has a separate machine-service setup
warning, so it does not establish ordinary cold startup; its 600-pixel window
check was not established. Existing configuration, models and source documents
were preserved.

The installed phone also opened the embedded XFCE desktop through the normal
Display action with the packaged `0755` launcher, then turned Display off through
the native control. Files navigation remained responsive during cold Office
loading, and the document rendered successfully. Native landscape pane dragging
passed. A phone Files-dock gesture result was not established because the test
browser's picture-in-picture overlay intercepted input during the bounded check;
the original density and rotation settings were restored. This does not relabel
the desktop dock check as phone coverage.

Four confirmed corrections are being batched before another candidate: dynamic
References capture icons still selected colored donor artwork; native manual
session restoration reused an implicit empty tab and hid an explicitly restored
New Tab; and native Files launch readiness still waited for the chat catalogue
on both platforms. Overlapping desktop startup/Files selection could also show
a false protected-chat warning. The phone's native Termux update check also
reached a protected-settings allowlist that omitted the two new update actions,
despite the existing Java adapter handling them. References 1.0.10 changes only the normal action
artwork paths, retaining capture behavior and saving/error indicators. The
restoration fix uses native `SSTabRestored` and `SessionStore.isTabRestoring`; its
bounded one-module Xorg check passed the real failing flow, followed by exact
restoration of the original archive. Files now waits for authenticated application
readiness without catalogue/worker readiness, and desktop selection coalesces the
same backend startup. No public endpoint or authentication fallback was added.
These corrections still need their final packaged checks.

The reported desktop Files permission failure was reproduced in the published
Linux package: copying a temporary component directory propagated mode `0700`
to the root-owned installed Files directory. Packaging now gives that public
component directory mode `0755`; the final package gate checks entrypoint read
and parent traversal permissions. The Termux X11 launcher is explicitly installed
executable, and its final package mode is checked too. Private runtime data and
loader permissions retain their existing restrictions.

Files now starts asynchronously through the existing backend owner. Unchanged
source configuration no longer restarts Quantum or drains transfers, and Office
startup no longer holds the Files request drain. Sidecar launch returns its
normal authenticated tab descriptor before cold preparation completes. Office
remains on demand. The reported 120-second Office timeout has not been reproduced
or assigned a proven cause. A reversible five-module check in the installed
Android app opened a copy of the user's 16 MB thesis within 14 seconds; during
cold Office loading, a separate normal Files tab navigated home and the folder
successfully while the same Quantum process remained running. The original
modules, modes and settings were restored, and the original document was unchanged.
This is module evidence, not acceptance of a new packaged candidate.

The same batch restores deliberate versus provisional Pi reasoning choices,
uses native template capabilities and reasoning configuration, exposes actual
audio runtime devices, shortens audio model names and places advanced model
configuration inside Chat and images. The emulator's Whisper GPU initialization
reports an unavailable Vulkan extension; a listed llama GPU does not establish
Whisper GPU support or successful inference. No model download or inference was
performed for these changes.

Desktop and wide-screen pane changes, mobile Files tab ordering, native browser
downloads from the sidecar, GitHub-compatible Termux update tracking and monochrome
References artwork belong to this batch. The pinned X11 source advances to
`6dfb8b4a4cc887bc329284d31eb049d596bd1208`; pristine import and later adaptations
remain separate commits. Both native architectures and the paired Java/AIDL
sources compiled, with 16 KiB ELF alignment checked. Focused source/build review
does not replace final signed APK/backend pairing and installed desktop checks.

The corrections and remaining focused installed flows now carry into 153.6. The
153.5.4 publication below does not establish that these new regressions are fixed
in a published package. Scoped evidence is under `Bashkitten-Acceptance/`, in
`android-regression-20261030/module-overlay/focused-summary.json`,
`package-permissions-20261030/`, `audio-device-guidance-20261030/`,
`local-reasoning-20261030/` and `termux-update-20261030/verification.json`.

## Published 153.5.4 prerelease — 30 October 2026

[BashKitten 153.5.4](https://github.com/openresearchtools/BashKitten/releases/tag/v153.5.4)
was published by the successful normal
[publication workflow 40991977149](https://github.com/openresearchtools/BashKitten/actions/runs/40991977149).
The actual tag points to `bde45b30065badac617e5b548b4acfa5454a3f62`;
GitHub confirms prerelease true, draft false and latest false. All 47 published
asset names, sizes and server SHA-256 digests match the release manifest and
checksums: six primary binaries, six auxiliary packages and 24 corresponding-source
archives represented by 29 source assets, plus metadata/reconstruction files.
This is a testing prerelease, with the existing testing notice retained.

Exact source `bde45b30065badac617e5b548b4acfa5454a3f62` passed the full
[candidate run 40982042345](https://github.com/openresearchtools/BashKitten/actions/runs/40982042345),
attempt 2: all 62 effective jobs, all six primary binaries, eight Office/Files
components and the matching source/legal gate. The retry retained 57 successful
executions and ran five failed/dependent jobs. A transient wrong response from
the pinned zlib URL was rejected by the existing checksum check; the retry used
the verified source cache. No source URL, pin or checksum was weakened. The
completed browser archive was reused through the existing producer verification;
its original build identity remains recorded accurately.

The final signed Android APK and matching Termux backend/OS packages passed a
preserving update with the live manager at this exact source, host 1.0.1 and
capture 1.0.8. Two consecutive saves from the same native PDF tab produced the
correct PDF metadata and identical 12,576-byte files, without reloading or taking
focus from the source. The retrieval used normal-session cookies and excluded
private-session cookies. The brief native Office check passed the ordinary
Files → Quantum → document → File → Options route: the existing dialog and
Cancel/Save controls fit the 414-pixel phone viewport. No overlays, preference
changes or repeated full acceptance campaign were used for these final checks.

Main About retains the complete notices, upstream/source links and BashKitten
modification information for Zotero-derived components, Collabora Online and its
LibreOffice engine, File Browser Quantum and other bundled dependencies. Component
legal UIs remain available too. The final package comparison retained all 3,057
Linux and 2,428 Termux full notice texts with no empty notices; metadata changes
only advance the corresponding-source links. All 105 backend source files are
unchanged from the installed `72abe63d` Wayland/Xorg checks, so those results and
their main About interactions are carried forward explicitly. The final Office
mobile CSS matches the tested native-menu/dialog module; the packaged JavaScript
differs only in ordering/wrapping of identical datepicker locale modules.

Build/package receipts are under
`Bashkitten-Acceptance/candidates/153.5.4-bde45b30065b/`, including
`complete-candidate-verification.json`, `published-release-verification.json`,
`verified-pairing.json` and the Linux/
Termux application and Office asset comparisons. Final installed phone evidence
is in `Bashkitten-Acceptance/android-final-bde45b-20261030/focused-summary.json`,
with scoped cleanup recorded and settings, models and profiles preserved. Earlier
native Options save/kit-exit/reopen evidence remains in the mobile module record below;
the final brief phone check does not relabel that as a repeated persistence test.

## Current integration checkpoint — 29 October 2026

The corrected `72abe63d2bd7a973bf1a170ae129387b5adba1bf` full batch passed
all 62 jobs in [40967838971](https://github.com/openresearchtools/BashKitten/actions/runs/40967838971),
including all six primary packages and the matching source/legal gate. Its
installed Wayland and Xorg checks passed the main About notices/source links and
native Office settings persistence. All 3,057 full Linux notice texts are retained.
Publication remains held on the Android follow-up described below.

The exact installed Android pair passed normal and redirected PDF capture, a
first standalone PDF save and native normal/private cookie isolation. Repeating
the same standalone PDF save exposed a connector classification error: the donor
clears its PDF button flag after success but retains the native PDF MIME type.
Capture 1.0.8 derives the existing PDF save flag from that retained MIME too,
preserving PDF metadata and the existing native source-tab stream. No browser,
cookie/session or permission changes are involved. The actual old failure and
corrected first-save/reset/second-save sequence passed focused source and packaged
checks; non-PDF and desktop transport behavior remained unchanged. The normal
offline extension build passed. A corrected signed Android installation remains
required. Evidence is in `Bashkitten-Acceptance/references-repeat-pdf-20261030/`.

The installed phone's main About page passed the selected Zotero, Collabora and
Quantum full-notice/source/modification-link checks. Its native Office menu
omitted Options, and the existing dialog's fixed 800-pixel width put controls
outside the phone viewport. Named patch `0028` exposes the existing action in
the four mobile menus and bounds the existing settings iframe with scoped CSS.
The native gate, fields, save handler and authorization are unchanged. A 15-second
frontend-only build passed without changing the engine/server. The reversible
phone module check passed actual File → Options, visible controls, native Save,
full kit shutdown and fresh reopening with the chosen setting retained. The
original choice and all four original files/modes/hashes were restored. Evidence:
`Bashkitten-Acceptance/office-mobile-options-20261030/android-native-options-summary.json`.
This remains module evidence pending the coherent rebuilt package.

The subsequent `479ab3a2513d73cc558d8f0d074a9e87d1e232e9` full batch
[40958050104](https://github.com/openresearchtools/BashKitten/actions/runs/40958050104)
hit one Termux ARM64 desktop-package failure: GNU make selected its built-in
C-to-executable rule for libdbusmenu's source XML during installation. The fix
uses native `make -r` only for that dependency's existing build/install calls.
The actual donor failure was reproduced; the corrected build/install and a
fresh GTK build passed with source XML unchanged. Independent review passed.
The corrected ARM64 CI package and full release gate remain pending. Healthy
producers continue for normal validated reuse; this failed batch is not releasable.

The full `53c81a4c27561888d5f6ff9d5d145929f925b09b` batch passed all
62 jobs in [40917628193](https://github.com/openresearchtools/BashKitten/actions/runs/40917628193),
including all six primary packages, eight Office/Files components and the normal
matching source/legal gate. Complete artifact `12922311255` is retained without
another local download. Publication remains held on the installed Android result.

The exact installed `53c81` package passed the focused Wayland and real-Xorg
checks. These covered References metadata persistence, native extension entry,
Files appearance/launching and Office filename/light rendering. Wayland also
completed a packaged native citation refresh without the legacy UNO banner.
Normal Quit drained the scoped services and preserved existing settings. Evidence
is in `Bashkitten-Acceptance/candidates/153.5.4-53c81a4c2756/wayland-final/`
and `Bashkitten-Acceptance/native-xorg-final-53c81-20261029/`.

The coherent Android installation preserves its configuration and cached models
and runs the exact `53c81` manager, host 1.0.1 and capture 1.0.6. Its first capture
request now reaches the backend, but the chooser remains pending. The Java
References host completes `GeckoResult` with `JSONObject`, which the pinned
Gecko JNI reply carrier does not support; it requires `GeckoBundle`. The narrow
host correction uses native `GeckoBundle.fromJSONObject` for success and error
replies. This does not change authorization or transport. The complete host and
pinned `GeckoBundle` sources compile, and 16 carrier checks passed, including
nested values, error replies and sender rejection. This is not an installed JNI
round trip. Visiting the same Files tab after a browser restart passed on the
coherent Android candidate. Capture and the phone metadata pane remain blocked
by the host reply until the corrected APK is installed; no Android capture pass
or release is claimed.
Evidence is in `Bashkitten-Acceptance/android-final-53c81-20261029/`.

The subsequent exact `1f8341ccb402edb478e3192fc68d30ba7aa95162` diagnostic
passed native-only parent [40931329451](https://github.com/openresearchtools/BashKitten/actions/runs/40931329451)
and signed x86 Android daughter [40931342528](https://github.com/openresearchtools/bashkitten-build-android-x86_64/actions/runs/40931342528).
Its actual APK bytecode contains both native bundle conversions. Installed on
the phone with its matching backend/OS packages, the native reply now completes:
the project chooser loads and the References manager opens. The actual phone
metadata pane passed five editable identifier fields, wrapping/scrolling,
reachable sticky actions and one native UI save verified through the API.
No soft-keyboard layout result is claimed for that check. Settings and cached
models were preserved. Evidence is in `Bashkitten-Acceptance/android-capture-1f8341-20261029/`.

The first controlled PDF capture saved metadata but failed before any request
reached the fixture server. Its injected connector script called Firefox's
background-only `runtime.getPlatformInfo` API. Capture 1.0.7 now obtains that
boolean through the existing donor ItemSaver messaging namespace. Sixteen
focused source/packaged cases and one offline connector build passed; installed
PDF capture still awaits the updated signed APK. The ordinary manual connector
update facility requires a signed XPI; the locally built unsigned XPI does not
establish Android acceptance. No signature bypass is used. Diagnostic builds
remain ineligible for publication without the normal full release gate.

The coherent `87c68c876808a61f174fdc36cc02b509f0c4b051` build passed all
62 jobs in [40878527390](https://github.com/openresearchtools/BashKitten/actions/runs/40878527390),
including six primary binaries, eight Office/Files jobs and the normal matching
source/legal/complete-candidate gate. Its complete artifact is `12903898838`.
Publication remains held: later source fixes and the Android capture failure
make this successful build an intermediate candidate, not the final delivery.

Focused installed Wayland and Xorg checks exercised independent References
projects, moved Bibliography attachments, Files/Changes and Files-to-Office
launching. Wayland also checked native upload/download and an unsent Reference
in chat with the exact owning path. The sent-message Markdown-link and stored
attachment-card click paths were not exercised without a configured model;
source checks are not substituted for those installed results. Evidence is in
`Bashkitten-Acceptance/candidates/153.5.4-87c68c876808/wayland-limited/`
and `Bashkitten-Acceptance/native-xorg-changed-87c68-20261029/`.

The matching installed Android APK/backend/OS passed native Files tab-group,
child-tab inheritance, restart persistence and the ordinary flat widescreen
strip checks. References capture still returned an opaque error before showing
destinations; no successful capture is claimed. Restored service tabs also
needed their native route rebound after browser restart. The existing authority
and service owners are being retained while these specific gaps are corrected.
Evidence is in `Bashkitten-Acceptance/android-native-87c68-20261029/`.

The exact committed `1a1d88490c974d1a5c7475f81ef341ead234770a` diagnostic
built successfully through native-only parent
[40906939972](https://github.com/openresearchtools/BashKitten/actions/runs/40906939972)
and signed Android x86 daughter
[40906956016](https://github.com/openresearchtools/bashkitten-build-android-x86_64/actions/runs/40906956016).
It contains the Files appearance/scope/pane corrections and bounded native
References error reporting. Its signed APK and exact backend/OS pair were
verified and installed. The normal complete-release gate was intentionally
skipped for this diagnostic; it cannot be published as the complete candidate.

The coherent installed retry still failed before reaching the Java References
handler. The built-in host lacked `geckoViewAddons`, so Gecko selected its
unsupported desktop native-app path on Android. The host manifest now requests
the native GeckoView permission and has version 1.0.1 so existing profiles update.
Desktop staging and sender/authorization checks are unchanged. Twelve focused
staging/native-source checks passed; actual corrected capture remains pending
the next candidate. The earlier mixed-runtime attempt is recorded separately
from the coherent retry in `Bashkitten-Acceptance/android-references-diagnostic-1a1d-20261029/`.

The shared citation processor now uses the exact pinned Zotero processor and
Style settings. Five independent native-oracle cases, packaged payload/legal
checks and the real References worker passed. A narrow Office adapter change
also passed ten native Writer checks and three occurrence/copy checks, including
Vancouver numbering, real save/reopen, unchanged-citation formatting and native
idle autosave. Those module diagnostics do not claim a rebuilt installed
candidate. Evidence is under `BashkittenBuild/verification/citation-formatting-20261029/`
and `office-citation-basics-20261029/`. The subsequent Writer bibliography change
uses the native `Bibliography 1` style and passed twelve focused native checks,
including style customizations, direct-format reset and real save/reopen.

The integrated metadata/identity changes passed 21 focused tests: exact normalized
identifier merging, complementary metadata, retained attachments and relocation,
user/Pi metadata editing and shared citation numbering after an item merge.
A reversible References-only overlay at `218df4b1c8` on the installed `87c68`
browser passed desktop UI-to-API/API-to-UI editing, a local XML attachment and
live light/dark appearance. Original files, settings and four existing databases
were restored unchanged. This is module verification, not a coherent new build;
phone-width rendering is deferred to the actual Android candidate. Evidence is
in `Bashkitten-Acceptance/references-metadata-20261029/`.

The [component attribution map](../references/legal/COMPONENT-ATTRIBUTION.md)
identifies pinned upstream sources, our adapters, modifications and retained
license terms, and passed inclusion checks in the existing offline legal payload.
Office also enables native `hide_legacy_script_warning`, suppressing only the
legacy UNO banner while preserving API support, operation errors and developer
compatibility information. Its effective native configuration check passed.

## Privacy and offline English proofing checkpoint — 29 October 2026

The user's clarified privacy boundary prohibits silent automatic external
telemetry, log/error reporting and uploads of user files, environment data or
secrets. Local logs remain allowed and unchanged. Intentional user/agent
uploads, exports, lookups and browsing, including document-specified remote
images and styles, remain supported. These document assets are not an app
telemetry finding; no CSP restriction or logging change is requested.

Focused source, effective-configuration and selected-artifact audits found no
enabled automatic external reporter in the paths reviewed. Files' native
analytics publisher is excluded and update checks are disabled. Office's
optional external reporting, remote configuration and AI/grammar services are
disabled or unconfigured; References' error/debug uploads and translation-failure
transport are removed, with translator updates reading bundled resources. Pi's
native offline/telemetry flags suppress its install reporter. Evidence, including
exact payload identities and limits, is:

- `/run/media/user/Data/BashkittenBuild/verification/files-privacy-audit-20261029/audit.json`
  covers Linux `53c81` and the selected Termux `1f8341` Files artifact.
- `/run/media/user/Data/BashkittenBuild/verification/office-egress-audit-20261029/result.json`
  records native Office source and effective installed Linux `53c81` settings.
- `/run/media/user/Data/BashkittenBuild/verification/references-privacy-20261029/result.json`
  covers installed `53c81` capture 1.0.6 and built `e6d71` capture 1.0.7, with
  eleven isolated reporting/update checks. It does not establish installed 1.0.7
  capture acceptance.

The existing Xorg owner's bounded fresh-fixture Linux `53c81` observer captured
only loopback connection destinations during its Files phase and combined
Office/empty-References startup/idle phase. Native Markdown displayed an explicit
remote image and a local sibling image, as allowed. The separate browser-startup
baseline has source/DNS-supported filter/security address matches. Its two
initially unclassified Fastly addresses later matched public DNS for Firefox
Remote Settings attachments, consistent with enabled signed security-data
downloads; shared CDN hosting leaves individual requests unproven. The mapping
is recorded in `startup-fastly-address-mapping.json` in the Files audit directory.
The observer excludes payloads, headers, environment and DNS names, and cannot
establish all traffic on pre-existing sockets or unconnected UDP destinations.
These results and source audits do not establish universal absence of reporting.
Receipt: `/home/user/Bashkitten-Acceptance/privacy-files-53c81-20261029/bounded-runtime-summary.json`.

Installed Linux `53c81` passed native UK/US Hunspell spelling, suggestions,
local Lightproof spacing/punctuation checks and Save, with the normal editor's
spelling suggestions and language choices observed. Disabled LanguageTool
advertised no locales. Receipts are `native-english-functional.json` and
`linux-linguistic-packaging.json` in the Office audit directory above. Termux
`1f8341` has verified installed linguistic assets/registrations only; no matching
functional or GUI proofing result is claimed.

The Spelling dialog's native Options button is already reachable. The new WOPI
settings bridge enables native File → Options and persists its browser settings,
XCU and view settings through the existing authenticated owner. Missing English
grammar, capitalization, repeated-word, paired-punctuation and spacing choices
default on; explicit saved choices remain intact. Preferences use the verified
local/remote principal within the backend, surviving cookie/grant rotation.
No Office engine or browser-core changes are required.

Five Go race tests, the owner identity/storage test and the native settings-proxy
test passed, including actual pinned Options-generated XML, scoped upload/read
requests and snapshot views. Independent review passed. Evidence is under
`BashkittenBuild/verification/office-native-settings-20261029/`.

The native Xorg module check then passed visible defaults, one saved false
choice, actual document-kit exit, reopening with that choice retained, and a
normal modified-document Save. It exposed and fixed two integration gaps: the
native manifest needs `kind: user`, and upstream blocks the shared settings
JavaScript when its admin console is disabled. Named patch `0027` removes only
that shared-asset restriction; the admin page still returned 403. The server-only
cached rebuild took 9.6 seconds without rebuilding the engine or browser.

Receipt: `Bashkitten-Acceptance/office-native-settings-module-20261029/native-settings-module-summary.json`.
This was a reversible diagnostic overlay with an explicitly recorded local
server lineage, not a coherent rebuilt package. All seven original installed
files and modes were restored, and normal Quit drained the test processes.
The saved choice remains only in the isolated test profile. Matching rebuilt
packages and the focused Android checks remain pending.

The main About license inventory already contains the checked References/Zotero,
Files/Quantum and Office/Collabora notices alongside their dependencies. The
collector and existing desktop/offline renderers now expose source, revision,
modification and attribution metadata as well as the full text. Safe HTTP(S)
links use ordinary browser navigation; local paths remain text, and long entries
wrap. Component-specific legal pages remain available too. A replay with the
actual `53c81` inventory retained all 3,057 notice texts byte-for-byte and passed
five focused rendering/escaping checks. Desktop Help → About also links to this
same bundled inventory, alongside Mozilla's existing Licensing link; six native
event-order cases passed. Missing source metadata cannot silently drop valid
notices, with three focused regression cases passing. Evidence is under
`BashkittenBuild/verification/main-about-licenses-20261029/`. The updated main
About view still needs the focused installed check on the new candidate.

## Earlier integration checkpoint — 29 October 2026

The earlier coherent build is version **153.5.4** at
`45390d6a25518f69eb36fb1de436f915a572a83d`, main
[40837599063](https://github.com/openresearchtools/BashKitten/actions/runs/40837599063),
which finished **successfully**. All six primary binary targets, eight native
Office/Files jobs, normal source collection and the existing complete-candidate
gate passed. Source collection completed in 18m 53s and uploaded its 15-file,
8,617,195,586-byte artifact `12882292291`. The normal `release.py` gate verified
the six binaries and matching source inventory and uploaded the 47-file,
21,195,582,964-byte complete artifact `12884374054`. Release publication remains
held for installed review; an Actions artifact is not a published prerelease.

The current source updates bundled Pi to official 1.4.0 in `81a96b5996`.
Exact source/package pins, all 164 locked npm archives and full notices, focused
extension/provider checks and isolated native RPC checks passed. This is not
installed Android/Linux acceptance of the updated runtime.

The actual staged 45390 Linux amd64 DEB and production x86_64 APK passed the
existing native license/About checks: 3,056 and 2,918 complete records
respectively, including all 2,427 matching Termux companion records in the APK,
the complete Go texts, compiled Gecko/capture notices and Office branding.
Dependency/source manifests are unchanged since cf62. The audit used the staged
packages and successful normal CI source/gate logs; neither large artifact was
downloaded or independently unpacked locally. Receipts are under
`Bashkitten-Acceptance/final-packages-legal-45390-20261029/` in
`acceptance-review.json`, `verification.json` and `apk-verification.json`.
The source and complete-gate receipts are in
`Bashkitten-Acceptance/candidates/153.5.4-45390d6a2551/` as
`source-collection/verification.json` and `complete-candidate-verification.json`.

Clean installed 45390 real-Xorg testing passed rebuilt empty-query clearing and
Entire-library export scope, native secondary-click menus, References
registration and one controlled native-menu COinS capture with an HTML attachment.
Default Pin to Toolbar was checked, while the button was not visible in the
navigation bar or the `»` menu. The initial report classified this as a default
placement failure. Native source review corrected that interpretation:
`browser_action.default_area` is `navbar`, and WebExtension overflow uses the
separate Extensions panel. Before re-pinning, its actual References row opened
the chooser and saved Alpha. The default action was functional; direct navbar
visibility/overflow state at that viewport remains unresolved, with no product
fix justified by this evidence.
Files opened the uploaded DOCX in native light Office; actual GUI type/Save
persisted its marker, PDF export opened an ordinary native PDF tab, and normal
reopen retained the edit. This was one DOCX/PDF round trip, not six-format or
browserless dirty-save acceptance; the PDF helper's filesystem-download wait
timed out because the export opened the normal viewer. Normal Local Off/Quit
preserved profiles, models and custom INI. The receipt is
`Bashkitten-Acceptance/native-xorg-153.5.4-45390-20261029/installed-acceptance-summary.json`.

The coherent Xorg capture follow-up passed selector Cancel with exact unchanged
item/attachment manifests, website snapshot, byte-exact ordinary PDF capture and
overlapping explicit destinations in two separate databases/Bibliography roots.
Those toolbar workflows followed manual native unpin/re-pin. The successful
pre-repin Extensions-row capture remains separate evidence; the earlier navbar
observation does not establish an unavailable action. Native manager confirmation
and normal Local Off/Quit passed. The annotated receipt retains references to
the unchanged raw evidence:
`Bashkitten-Acceptance/native-xorg-153.5.4-45390-20261029/capture-followup/installed-capture-summary.json`.
The adjacent `source-placement-review.json` records the corrected interpretation.

The clean 45390 Wayland package separately passed native right-click, Office
edit/Save and References opening from an ordinary web tab. Invoking References
from a Files/Office application tab exposed a real failure:
`No cookie store exists with ID firefox-container-3025207296`. That is the
internal isolated service context, not a registered Firefox container. The
proposed custom native `create-source-tab` bridge was withdrawn before commit.
The plugin-only correction uses ordinary native tabs and the browser's actual
response stream, without cookie export or a new tab/cookie bridge. Its actual
public ACM replay saved 2,570,670 bytes with SHA-256
`434376057dbe6fc3e44d0fdb7268b56126e9b47ca9d6aa9e05cf2e738f72e81d`,
matching the recorded native Zotero PDF. The final inline-disposition correction passed the installed native background
PDF replay, preserving the active manager and exact PDF bytes. The artificial normal-session request to the isolated
Files application origin is not publisher-cookie parity evidence. Receipts are
in `Bashkitten-Acceptance/references-native-tabs-20261029/`; the original failure is in
`Bashkitten-Acceptance/native-wayland-153.5.4-45390-20261029/verification.json`.
Android's exact 45390 APK/backend/OS pairing and both active built-in References
registrations passed, but the visible enabled References Add action did nothing
when tapped. Both native API-created and + tabs retain BashKitten context IDs as
strings. A separate correction to the existing native tabs API initializes the
ordinary engine session and preserves its actual decoded context/privacy state;
production Kotlin compilation passed. It adds no custom tab/cookie bridge or
cookie copying. Runtime invocation, background focus and private-session checks
remain pending a coherent signed candidate.
Its receipts are `installed-package-identity.json` and `installed-addon-state.json`
under `Bashkitten-Acceptance/android-153.5.4-45390d6a2551-20261029/`.

The current module batch implements the user's independent named References
projects, with an automatic Default per backend, direct clickable sidebar,
New project and per-project Settings. Capture and Office choose a References
project only; collections are removed from product controls while existing data
and database/citation identities are preserved. Office's explicit formatted-text
unlink confirmation remains. Shared native colors and compact capture are
included. This new model supersedes the earlier 18-check workspace-based result.
Focused manager DOM (9), packaged Office settings (8) and real SQLite/service (9)
checks passed. Actual service capture/naming, two-file folder move and restart
checks (7), plus manager lifecycle/direct-launch checks (13), also passed.
Combined installed verification remains pending. Receipts are in `references-independent-projects-20261029/` under
`Bashkitten-Acceptance/`. The separate
Android existing-native-API correction has compilation/regression evidence,
with signed-candidate runtime validation still pending. The current verification
scope is Files/Office/References, model/audio changes and reported UI fixes plus
their direct integrations; unrelated full-app campaigns are not being repeated.

Coherent 45390 Android portrait and landscape toolbar replay passed: the obsolete
separate sidebar button was absent, the main logo opened Agent and its sidebar,
and the existing inside Hide Agent action returned to the ordinary browser.
This did not make the separate References Add action work. The receipt is
`android-153.5.4-45390d6a2551-20261029/toolbar-portrait-landscape-result.json`
under `Bashkitten-Acceptance/`. The existing native setting
`Settings → Customize → Tab bar display → Show tab bar on wide windows` is
also passed actual UI replay: Off hid the strip and persisted through normal
navigation; On restored it. The original setting and rotation were restored.
No duplicate setting was added. The receipt is `native-tabbar-off-on-result.json`
in the same Android evidence directory.

Fresh 45390 phone Files → Office Writer → References passed first-use Settings
with Library first, Save settings, the compact chooser and search/Cancel.
The library was empty, so no citation insertion is claimed; the software IME
did not open in this run. This is `files-office-bounded-smoke.json` in the same
directory, not broader native Save/export/reopen acceptance.

The distinct References book icon and chooser cleanup are committed in
`ec89cd16b8`; installed icon acceptance remains pending. Office filename-title
fix `50fdb0ede0` passed an actual two-file Wayland overlay using native Collabora
`Doc_Title`: initial/load titles, native rename with an escaped ampersand, normal
reload and the renamed disk file all matched. The original 45390 `omni.ja` was
restored; this is not a coherent rebuild. Its receipt is
`Bashkitten-Acceptance/office-filename-title-20261029/verification.json`.

The preceding cf62 binary batch was
[40823770402](https://github.com/openresearchtools/BashKitten/actions/runs/40823770402),
version **153.5.4**, from `cf62bf9be5cd068921f5941916099531cd3ce1a7`.
All eight native Office/Files jobs, both Linux packages, both Termux packages and
both Android APKs passed. This batch includes `550d52b0a2`, `f09b7d27bb` and the
native short-frame/collapsed-menu changes. The x86_64 APK's production signing
identity and exact-source backend/OS pairing were verified. The parent source
job was cancelled after its collection step ran for 1h 23m 44s; binary artifacts
were retained.
No corresponding-source or complete-candidate artifact/pass was produced; these
binary results do not establish source publication, prerelease completion or
full installed acceptance. The build receipt is
`verification/ci-monitor-cf62bf9be5cd-20261029.json`; staged identities are under
`Bashkitten-Acceptance/candidates/153.5.4-cf62bf9be5cd/`.

Later source-preparation correction `1eab4ec1df` adds native Git bulk backfill
before the existing collector. The exact workflow step passed a pinned shallow
partial-clone fixture; the existing exporter produced identical archive bytes
with one fetch process instead of 40. Source serialization and content are
unchanged. This fixture preceded the actual 45390 source-collection pass above;
neither is a release-publication claim.
Receipts are under `Bashkitten-Acceptance/source-archive-backfill-20261029/` in
`workflow-step-verification.json` and `verified-run/verification.json`.
`9e64389692` adds disk/object-usage reporting around that native backfill;
it does not change source serialization or establish a publication pass.

The actual cf62 Linux amd64 DEB also passed the existing final-package audit:
all 3,056 full-text records matched the normal collector and offline About,
including both structured Go records, all compiled Gecko/capture notices and
installed Office branding. The actual production x86_64 APK passed all 2,918
full-text records against the native validator and exact offline About array,
preserving all 2,427 matching Termux companion records, four compiled Gecko
records and 26 capture records. Both Go 1.27.2 texts match their 38 pinned
original members and retain declared terms. Its SHA256 is
`7d397ad240ad08dcb6ea6fcbb5900ea25a37187800e2a2978badefc46302e275`.
The independent current-source receipts are `verification.json` and
`apk-verification.json` under
`Bashkitten-Acceptance/final-packages-legal-cf62-20261029/`.
These are artifact legal/About passes; matching source publication remains
separate, and the 16f0 evidence below retains its historical identity.

The preceding full Actions attempt was
[40815191205](https://github.com/openresearchtools/BashKitten/actions/runs/40815191205),
version **153.5.4**, from `16f0a0330ac7f800fba6c97b8aaf778d32922843`.
It includes guided/background model setup, the replacement citation commands and
the source/license corrections, plus the remote application URL and phone
viewport fixes. All seven related repository queues were checked clear after
cancelling the five older active runs. Normal preparation `40815045392` passed
without modifying the frozen source. The attempt ended with the source and APK
failures below; it is not complete installed-product acceptance.

That run subsequently passed all four Node jobs, both Termux Search jobs and all
eight native Office/Files jobs in daughter
[40815382518](https://github.com/openresearchtools/office-builds/actions/runs/40815382518):
each component passed Linux amd64/arm64 and Termux aarch64/x86_64. Both complete
Linux DEBs and both Termux packages also built. Both Android Gecko compilations
passed, but neither APK was produced: the ARM64 and x86_64 Gradle builds failed
at `stageBashKittenAbout` with `KeyError: 'licenses'`. The new native Go runtime
record supplies full `text` and `licenseFiles`; that About loop expected module
license filenames. `f09b7d27bb` updates the existing loop to accept both forms,
preserving declared terms and rejecting incomplete text. Its focused offline
receipt used the actual 16f0 remote Go metadata: 18 filename records plus the
Go 1.27.2 runtime record, retaining its 73,503-character text and all 38 original
member hashes. The existing attribution record also remained. That focused
receipt is generator verification; the later cf62 APK build passes are separate.

Source collection failed because it checked an original archive
against the checksum of a license member inside it. `550d52b0a2` corrects the
existing collectors to verify the archive and extracted notice independently;
no dependency pins or license texts changed. Independent retained originals
confirmed all 57 affected notice associations across 16 archives. The corrected
source/APK callbacks packaged all 624 native source records offline and rejected
damaged archives, members and retained notices. Those artifacts retain
`16f0a0330a`; the subsequent normal source-collection pass belongs to 45390 above.
Build outcomes are recorded in
`verification/ci-monitor-40811847474-to-16f0-20261029.json`; the focused source and
Android About receipts are under `Bashkitten-Acceptance/` in
`android-notice-archive-16f0-20261029/owner-regression.json` and
`android-about-go-16f0-20261029/verification.json`.

The actual 16f0 Linux amd64 DEB passed the final packaged legal/About audit.
The unchanged collector reproduced all 3,056 full-text records, and the packaged
offline About contained that exact array. Native component inventories, all 30
compiled Gecko/capture notice records and installed Office branding matched.
Both structured Go runtime records retained their full text and 38 original
hashes; Office's 66 original Python legal files reached About. This package has
SHA256 `23da7e91d9980a716f1f9cf67ae78998afd43f97217fdea83d62429bd8b1250e`.
The receipt is `Bashkitten-Acceptance/final-deb-legal-16f0-20261029/verification.json`.
It establishes packaged notice coverage, not source publication or installed
feature acceptance. The later cf62 binary results do not relabel this 16f0 audit;
matching published sources and full installed acceptance remain outstanding.

The preceding `40811847474` attempt used `aa79161e6956` and exposed a stale Termux
Search inventory checksum after the Rust runtime source-lock update. The inventory
now matches that lock (`a5296491b5`); the unchanged
pinned Termux archive was verified and extracted successfully from the offline
cache. Both Linux Node restore jobs also hit GitHub HTTP 502 while reading prior
producer job lists, before compilation; `c3b0cef2e6` adds bounded retries for those
idempotent metadata reads, retaining fatal authentication and integrity failures.
Files Termux ARM64 failed while Git tried to fetch the omitted root `.gitignore`;
`a1a1a8b336` includes it in the native sparse checkout. All four Office native
artifacts passed at that old source, separately from the failed Files job and
blocked final package collection. Old artifacts retain their original identity.

Strict checks on the actual `aa79161e6956` Linux ARM64 and Termux x86_64 Office
artifacts passed: all 66 original Python legal files are present, all 14
Windows-only launchers are absent, and native source inventories, fonts and
notices match. Matching published sources and final packaged About for that
attempt remain unverified; the later 16f0 DEB check is recorded separately above.

The previous full Actions run was `40787710453`, from
`eb56a3a10ebc5bbba76c364dac1273ed0458e418`. Both Linux and both Android browser
compiles passed. Android packaging exhausted its old 30-minute companion wait
while native Office builds were still running. The bounded shared wait
correction is committed in `a3c456e8a8` and deployed to the four builder repos;
it does not change those already-running workflows. Office Linux ARM64 and both
Termux targets subsequently passed. The Linux ARM64 complete candidate also passed;
Office Linux amd64 reached packaging before cancellation, with its compiler cache
saved; no completed artifact is claimed. The main amd64 collector lost its hosted
runner connection while its daughter build continued waiting for Office. These
are outcomes for the original source revision, not subsequent fixes. Later
binary batches and their remaining acceptance gates are recorded above.

The Office UI/Pi replays below use the isolated `4be2563e5e` desktop browser or
the older 153.5.2 Android APK with explicitly recorded component overlays.
They are not acceptance of a newer complete package. The separate cf62 Android
model-setup check is recorded in the native implementation status.
The existing Weston viewer/input seat was restored before continuing trusted
native input tests; earlier unfocused clicks are not successful UI evidence.

- Native Office first-use project/style binding and two-source insertion ran in
  Writer, Calc and Impress. Writer citation editing, bibliography and style
  changes were saved through the actual UI. The later command/history replays
  below are bounded checks; complete mobile and concurrent-edit UI coverage
  remains outstanding.
- A moved Office runtime exposed a stale native systemplate alias: the cache
  compared only the source revision, so kit font paths retained the previous
  installation prefix. `0ec5251785` includes the engine path in that existing
  cache key. Native setup then repaired the alias; the same saved document
  exported/downloaded successfully with embedded fonts, citations and bibliography.
  This uses upstream setup, not a separate rendering or font implementation.
- Real References capture retained the chosen project while another project
  became active, including the native multiple-item selector and cancellation.
  Capture `1.0.4` removes the donor's conflicting screenshot shortcut while
  retaining native user-configurable commands. Android capture on the older
  installed APK is absent; current-APK acceptance is still required.
- The ten-identifier resolver comparison and actual browser continuation are
  recorded separately. Native metadata-to-Extra preservation is committed in
  `25d5bd662e`; manual attachment parenting in `cf05cb3e15`. Further installed
  capture/manager flows, real remote routing and complete stock Pi Office work
  remain in progress, not accepted from source checks alone.
- Source collection now retains original Go proxy metadata (`421f46a879`).
  Search's exact Rust runtime sources/notices are recorded in `fe14e6d016`, and
  component-prefixed native notices reach offline About through `c78d90fe39`.
  These are corrections for the next complete source/package collection.

Later installed diagnostic checks passed native human/Pi co-editing: actual
keyboard input changed an ordinary Writer paragraph while the real bundled Pi
edited and refreshed an existing managed citation. Native inspection retained
both changes and the same citation field. The first attempt targeted protected
citation content and failed; it is not counted as a pass. The real Pi then saved
and exported the same document through native Office operations. The coordinator
downloaded that exact export through the existing trusted HTTPS authorization
flow; its 21,378-byte PDF retained both edits, the superscript citation and the
formatted bibliography in text and rendered inspection. `01f1d0b192` adds native
selection lookup and guards; six-format native module checks passed separately
from the later compact Citations menu replays below.

The subsequent actual bundled Pi 1.3.0/Qwen3.5-4B Calc/Impress run completed all
nine native calls with HTTP 200 and both `saved:true` acknowledgements. Calc
wrote/read cells and a formula; Impress opened/inspected the presentation,
inserted/read a text shape and saved. The normal Pi Stop ended the bounded test
after both saves, before a final model reply; no extra tool calls followed.
Earlier malformed model calls remain recorded failures. This is bounded native
tool proof on the diagnostic installation with overlays, not cf62 installed
acceptance or unprompted model reliability. The receipt is
`verification/office-native-ui-20261029/native-pi-calc-impress/calc-impress-native-results.json`.

The replacement plugin removes the visible Office References panel and exposes
labelled native Citations commands. One nonvisual native extension lifecycle
frame owns command dispatch and the existing modification listener; compact
dialogs reuse the shared chooser and document settings. Settings starts with
Library and shows catalogue style titles and friendly language names. Native
selection supplies the exact existing citation for Edit/Remove. Review caught
and corrected lifecycle cleanup and changes arriving during a busy operation.
The pinned frontend emit/strict/bundle checks and focused command/settings/
lifecycle checks pass. Installed diagnostic replays now cover the native commands
in all three desktop editors, using the recorded `3ed71534b2` plugin plus
`16f0a0330a` frontend overlay on the older signed browser:

- Writer Settings retained a style outside the initial catalogue page and friendly
  locale names; cancelling a library change preserved its binding. The chooser
  wrapped Title/Authors, showed Year, resized columns, kept Add fixed during
  horizontal scrolling and rendered 13 bounded visible rows. Native secondary
  click exposed Edit/Remove and reopened the exact selected two-source cluster.
  Real keyboard entry of a complete citation marker promoted it automatically,
  without clicking Convert, adding a second live native field.
- Calc's native Name Box focus selected A1 before Add/Edit preloaded its two
  sources. Remove cleared the cluster and bibliography entries; adding the two
  sources restored the managed cell citation and two bibliography entries.
  Impress shape and partial text selection both preloaded the exact cluster;
  confirming locator 21 preserved its native shape anchor and bibliography.
- Writer's native File → See history listed four versions. Retention changed
  50 → 51 → 50 through the UI. Open showed a native read-only snapshot in the
  same tab; Restore on the disposable UI document reopened an editable connection
  and retained both live anchors. This did not restore or alter the Pi documents.

The three receipts are in
`verification/office-native-ui-20261029/command-ui/` as
`writer-current-native-ui-evidence.json`, `calc-current-native-ui-evidence.json`
and `impress-current-native-ui-evidence.json`. They retain the diagnostic overlay
identity and do not establish fresh full-package or phone-format acceptance.

Native collapsed-menu patch `0025` (`84cb5faa8e`) also passed actual desktop
input at a 728px viewport: all six Citations labels appeared without the dummy
X, and Settings opened from the collapsed menu on a normal disposable document.
Library/style/language order and Cancel worked. This used a frontend-only
overlay with the old signed browser, native binary and plugin unchanged.
The receipt is
`verification/office-native-ui-20261029/command-ui/overflow-group/desktop-ui-evidence.json`.
A separate old-document restart exposed a surviving
WOPI lock; it is not a seamless restart pass.

Actual phone replay found that the outer Office iframe retained the 783px layout
height while the keyboard reduced the visible viewport to 486px. `16f0a0330a`
fits that existing iframe to the visual viewport and corrects the native inner
flex direction. After revalidating the served stylesheet, the editor measured
486px and Settings actions occupied y=407–451px, fully above the keyboard.
Typing in style search and tapping Cancel and Save passed with the portrait
keyboard open. Complete mobile-format coverage remains outstanding.

Later actual phone editing preserved a multi-source cluster when opening Edit
from a partial text selection, including the locator, prefix and suppress-author
settings. Native bibliography insertion produced two entries. These same anchors,
settings and rendered content survived a Cuttlefish restart. That restart recovered
the emulator's WebRTC process after its rotation sensor control crashed; it is
not an Office failure or a seamless-reconnect pass. Controlled Android landscape
then exposed a 45px visual viewport with clipped Settings actions.
`b263e805bd` applies a narrow named patch to the existing native extension frame
and shared Settings layout. Actual touch scrolling with the landscape keyboard
open then exposed Cancel and Save: Cancel closed a draft, and a separate Save
committed IEEE. Native read-only inspection under the same Termux UID 10122
confirmed revision 6, IEEE/en-US, the same two-source occurrence with locator,
prefix and suppress-author settings, and two bibliography entries with live
anchors. This was a short-frame overlay on the older APK; the controller update
required native Force Stop/reopen and does not prove seamless reconnect.
Phone evidence is `verification/office-command-phone-ui-20261029/evidence.json`;
the native state receipt is
`BashKittenOfficeBuild/20261028/diagnostics-6522/native-server/command-ui-20261029/writer-inspect-ieee-landscape-20261029.json`.
Later phone replay on that same older APK passed Writer's native history list,
immutable read-only Open, normal Back and Restore on the disposable proof file.
The restored snapshot predates the bibliography; no bibliography loss is inferred.
A typed citation marker automatically became a managed field, and selected
Remove preserved the original two-source cluster. Native PDF download completed
at 14,941 bytes. Calc and Impress each passed Settings, chooser, Confirm and Save;
Calc displayed the cell citation and bibliography. Impress's 12,471-byte PDF and
normal reopen contained the saved citation. Existing-shape editing, isolated new
shape insertion and a bounded inspector-lifecycle comparison later repainted
live; its two-entry bibliography also rendered and saved.

The initial Impress canvas missing-paint observation remains recorded and was
not reproduced by those bounded cases. The comparison inspector closed 841ms
before repaint, so a narrower callback race remains unexcluded. Default template
placeholders also overlap the native default insertion position; no layout
change was made during that investigation. Zoom and remaining fresh-candidate
Office acceptance remain open. These results and native receipt links are in
the same phone `evidence.json`; the final
state was portrait, unmodified, with no command drafts.

A later bounded replay on old 6522 passed landscape chooser touch scrolling and
actual Confirm with the real 45.233px IME viewport. Fourteen normal swipes
traversed the nested results list/dialog and exposed Confirm; the closed frame's
native comparison retained the citation ID, complete item order/options,
rendered text and anchor, with `missing:false`. The earlier helper incorrectly
required outer-dialog progress on every swipe; correcting that external harness
needed no product change. The receipt is
`verification/office-command-phone-ui-20261029/landscape-final-20261029/result.json`.
Its old 153.5.2 APK and explicit native/frontend/plugin hashes are retained;
this does not establish new 45390 phone Office acceptance.

The unmodified cf62 Linux amd64 DEB also passed bounded Files GUI checks in the
real-Xorg VM: native folder launch, new folder/rename/copy/move/delete, GTK
TXT/PDF upload, text/native PDF previews and byte-exact TXT/ZIP downloads. Two
projects shared one Quantum process; closing one tab preserved that process and
the remaining Files tab reloaded. The retained project picker and actual Changes
untracked-file view passed. Normal Local Off/Quit preserved the custom main INI.
The receipt is
`Bashkitten-Acceptance/files-xorg-153.5.4-cf62-20261029/installed-acceptance-summary.json`.
Shared-chat attachment upload, capture toolbar and native Save-As naming were
not proven by this Files checkpoint.

Desktop capture now passes the installed single/multiple-item, cancellation,
website snapshot, recognized/raw PDF, manual attachment, collection preservation
and overlapping two-project capture flows. `7c460a72f9` preserves collection
membership when parenting; `b0896a3fb6` preserves it on Leave standalone. Both
repairs were reproduced and replayed through the actual UI. The retained profile
needed native unpin/re-pin to display the capture toolbar button; fresh-candidate
default placement and Android capture still require installed checks.

Fresh cf62 Android verification found the capture assets present but its add-on
absent from the native registry; only the privileged host was active. The APK
omitted every `_locales` directory despite the capture manifest's `default_locale`
requirement, which native Gecko rejects. The library now uses the same native
asset filter already used by Fenix. The actual cached Android SDK asset merger
reproduced zero locales with its default filter and all 37 with the correction.
The existing staging helper also carries the component's full runtime inventory
for self-contained final-APK verification; checks reject missing locales/assets,
changed bytes and malformed inventories, including in a sparse collector checkout.
No runtime registration or privilege workaround was added. Evidence is
`verification/references-capture-android-cf62-20261029/native-addon-state.json`.
Adjacent `native-asset-filter-result.json` and `apk-inventory-check-result.json`
record the packaging checks, not installation of a rebuilt signed APK.
Fresh rebuilt capture installation and GUI saving remain pending.

Remote References and Files passed through the enrolled Tor/Chisel route with
trusted loopback HTTPS and separate local/remote libraries. Actual Office
edit/save, ordinary PDF rendering, native 4 MiB download with exact checksum,
live revocation and saved reconnect also passed. A normal download click exposed
the isolated fixture's read-only default Downloads directory. After selecting a
writable destination through native Preferences, an ordinary 32 MiB Files
download completed with an exact source checksum, and native cancellation removed
the partial repeat. This bounded transfer does not establish arbitrary-duration,
stall or auth-expiry coverage. `860ac0c38a` fixes reopening
already mapped application URLs through the owning route, with 27 focused cases
and the full Android Java compile passing; installed API replay remains pending.
The two same-UID diagnostic owners required a serialized handoff of Quantum,
Office and its storage service; all previous states were restored. Extended stalls,
auth expiry and sustained Office connection stability remain unaccepted.
Evidence is in `verification/real-remote-apps-20261029/`, including
`real-https-references.json` and `real-https-files-office.json`.

The installed snapshot CLI passed six-format JSON and DOCX text output without
changing any of the nine input snapshots. OOXML used distinct retained versions;
the ODF fixtures had one retained version each, so those calls checked equal-version
handling alongside the earlier changed-version semantic checks. The bounded
desktop and phone Writer history/Open/Restore UI replays are recorded above;
remaining format and fresh-candidate coverage remain pending.
Evidence is in `verification/office-snapshot-diff-20261029/` and the ordinary
remote transfer follow-up is `real-remote-apps-20261029/ordinary-files-transfer-replay.json`.

`c348ac5092` changes the existing shutdown owners to wait for native Office saves
before stopping callback services. Source fixtures passed native-exit ordering,
Caddy callback drain and failure cleanup in
`verification/office-shutdown-20261029/{signal-result,caddy-result}.json`.
The first installed replay passed on the isolated older browser with the reviewed
controller overlay: a saved DOCX reopened immediately editable after Office-only
stop/start with the same add-on process. Native append/Save/inspect returned 200
before and after restart, both disk markers remained, and no forced termination
or unlock failure occurred. The receipt is
`verification/office-shutdown-20261029/saved-office-only-result.json`.
The subsequent c348-only dirty Local Off replay **failed**: native inspection reported
modified content before Off, but the new marker was absent on disk before Off
and remained absent after the native process exited. The file hash and size
were unchanged despite no forced termination or unlock failure. Source
`c348ac5092` alone was insufficient for dirty final-save acceptance. Exact disk/stop receipts are
`dirty-before-local-off-disk.json`, `after-local-off-disk.json` and
`dirty-local-off-existing-evidence.json` in the same shutdown directory.
This later source change is not part of the cf62 binaries.

Native named patch `0026`, committed as `fe4951b1d7`, records the missing
modifying activity for `executescript` through the existing native owner.
The diagnostic server was built from `305911e75a` plus the recorded patch inputs
(server SHA256 prefix `9df5fb0a`), with engine, frontend and plugin unchanged.
Its actual three-format dirty Local Off replay passed: all documents were
modified and their new markers absent on disk immediately before Off; normal
Off completed in 2.716s, preserving the DOCX text, XLSX cells/SUM and PPTX shape.
The original failed DOCX remained unchanged. Read-only inspection followed by
Office-only stop preserved all three files' hashes/sizes/mtimes/inodes,
immutable snapshots and storage manifests. A final normal restart reopened all
three editable, with the same add-on process, and DOCX edit/native Save passed.
Receipts are `dirty-local-off-result.json`, `readonly-office-only-result.json`
and `saved-office-only-result.json` under
`verification/office-shutdown-20261029/proof-0026/`.
The combined `result.json` and adjacent
`build-0026/committed-source-link.json` link those actual build inputs to
`fe4951b1d7` without relabelling the diagnostic build as that clean commit.
These are diagnostic native-overlay passes. The later 45390 build includes the
patch, with the bounded coherent DOCX GUI check above; broader platform/format
acceptance remains separate and does not relabel these earlier results.

Likewise, `6b01947a60` uses native input semantics when clearing browser fields;
bounded helper/native-event checks are recorded in
`Bashkitten-Acceptance/browser-fill-clear-20261029/verification.json`.
The rebuilt 45390 Xorg clear-query/Entire-library scope and Wayland stable-field
clear checks passed above, alongside native secondary-click menus. Other actor
cases and the newly exposed application-context References failure remain open.

`73f0b90e85` separately corrects secondary clicks to use the existing native
WebDriver `mousedown`, `contextmenu`, `mouseup` sequence. Ten component checks
preserve ordinary-tab/frame authorization and button cleanup. The actual Files
test had reproduced the missing API menu while physical right-click worked;
the rebuilt-actor replay remains pending. Its receipt is
`Bashkitten-Acceptance/browser-right-click-component-20261029.json`.

Evidence lives outside Git under `BashkittenBuild/verification/`, including
`restored-native-seat-20261029`, `office-native-ui-20261029`,
`references-capture-ui-20261029` and `references-real-parity-20261028`.
The checkpoints below are historical: their earlier archive-retention statements
do not describe current Git storage. Dependency archives now use the verified
external source cache and matching corresponding-source artifacts; the completed
history cleanup is recorded separately in `docs/history/`.

## Implementation started — 28 October 2026

The user authorized implementation of the complete plan, parallel module work,
and the early browser integration iteration build. Editing needs no open editor
tab; agents can also open normal tabs to inspect rendering and native exports.
Module/UI/API iteration proceeds while the browser boundary is being prepared.

| Workstream | Current ownership / next integration evidence |
| --- | --- |
| Shared chat UI | Remove the internal Files manager; retain Changes/attachments/pickers; compact content-sized composer; normal Files launch |
| Native browser boundary | Delete prepared-document bridges; ordinary service-tab launch; small fixed References host on desktop and Android |
| Runtime | Existing lifetime/auth owners, lazy shared service startup, exact local/Chisel mappings and live project permission checks |
| Quantum/WOPI | Separately packaged upstream-derived add-on, source/account scopes, native saves/history and light editor launch |
| References | Separate project databases, native-derived translators/resolvers, bounded library UI and shared classic chooser |
| Capture extension | Pinned Connector save behavior, References branding, fixed-host contract and independently replaceable logic |
| Office API/plugin | Native agent session, three editor adapters, managed citations and snapshots-only comparison |
| Pi/reviewer | Frozen reviewer source/local delta, full References compatibility and live Office tools/skills |
| Build/package | Exact source/dependency graphs, ordinary Actions artifacts, native Linux/Termux recipes and early browser build |

Pristine source commits, before adaptations:

- `8bf5c7e61b` and `bccad2022c`: Quantum stable and selected upstream WOPI
  donor, including exact upstream ignored fixture/embed files. Per-file manifests
  were checked locally. Upstream fixtures are source provenance, not runtime data.
- `7db7e4b747`: Connector and its released translation/schema dependencies.
- `5e8d6eb05c`: References core/schema/translators, translation-server, classic
  dialog reference and CSL datasets. The desktop donor is source evidence and
  must not be included wholesale in the runtime package.
- `09596561dd`: Systematic Reviewer committed base, reviewed local delta and
  main-branch UI reference. The user's donor checkout was not changed.

An initial diagnostic against the temporary stock Collabora server succeeded:
an authenticated agent document session executed a native UNO text insertion,
received `.uno:Save` success and a WOPI save acknowledgement without an editor
tab. The preferred `cool.getActiveDocument().getBody().appendParagraph` call
failed in this release with an `XTypeProvider`/`findOverloads` error. The native
UNO compatibility path remains inside the independently replaceable adapter.
This proves one native operation, not complete editing/citation/platform support.

No new browser iteration build or installed integration acceptance is claimed
by this checkpoint. The sizing change still needs installed Android verification;
all acceptance groups in the plan remain open until their actual flows pass.

### Subsequent implementation checkpoint

The independent components now live at top-level `files/`, `office/` and
`references/` (`3ec354c0d4`). Existing imported file contents were preserved in
the move. Lifecycle/authorization adapters and Pi tools remain under `agent/`.
The agent's native Office connection uses existing backend authorization, with
no additional user account or login.

- Native capture adaptations were committed in `2cf37b2120`; its independent
  offline build passed. The ordinary capture extension and fixed privileged
  host are separate packages. Installed capture, challenge handling and signed
  independent update/rollback remain unverified.
- The backend HTTPS gateway diagnostic passed certificate validation against
  the existing backend CA, one-use launch, secure scoped cookies, nonce-replay
  rejection and origin checks. Evidence is outside the repository at
  `BashkittenBuild/verification/apps-boundary-20261028/https-gateway-evidence.json`.
  This does not establish normal-tab trust in the installed browser. The narrow
  native service-context trust changes require a new browser build.
- Native citation persistence diagnostics passed for DOCX, ODT, XLSX, ODS,
  PPTX and ODP after reopening saved copies. A separate check found missing
  native undo support for document metadata; the proposed generic native patch
  still needs compilation and runtime verification. UI, complete editing,
  concurrent users and mobile acceptance remain open.
- Native Linux Office compilation is in progress. All 121 selected engine
  dependency archives passed checksum verification. Large retained source
  archives use lossless parts for GitHub's individual-file limit.
- Landlock calls succeeded inside the real Termux app domain on the existing
  Android 17 emulator. Native engine/server porting and a running Termux Office
  server remain outstanding; this kernel diagnostic is not platform acceptance.
- The composer retains its original two-row baseline. Content sizing and resize
  remeasurement changes still need installed Android verification.

Upstream archive attributes omit 57 text schema files. The pristine source import
retains them, and release source collection now reads all tracked Git file
contents instead of applying those exclusions. This source-completeness change
does not substitute prebuilt executable binaries for native builds.

Build-history reconciliation uses the existing BashkittenBuild README, current
verification/acceptance records and the build-environment thread. The README
contains older candidate identities; the 24 October records include newer
artifact-build and rollback evidence. The 11 October Cuttlefish audio-buffer
repair supersedes the earlier silent-input diagnosis for that old candidate,
but does not establish dictation acceptance on the forthcoming iteration build.

### Native build and module checkpoint — 28 October 2026

The early desktop and Android browser compilations passed at
`4be2563e5efea3d396da2970a00e12885057cb10`. That revision fixes the desktop
generated-file jar syntax found in the first iteration. Package assembly is
separate: stale companion-source checks correctly stopped assembly, and the
companions are being rebuilt from the frozen source. Android OS and Display
companions have been rebuilt with the actual `153.5.2` version and verified
source/signing provenance. Neither compilation nor companion rebuilding is an
installed-browser acceptance claim.

The independently built Linux Files and Office components passed native
compilation. Generic native field-command undo and OOXML user-attribute
preservation are committed in `b24989fd68`; the Office plugin/API checkpoint is
`d76ed855d7`. The latter keeps distinct native participants, native token renewal,
the shared web citation chooser and explicit copied-reference import. Native
OOXML diagnostics preserved a 43,709-byte attribute payload through XLSX/ODS and
PPTX/ODP conversion and cross-document clipboard operations. Complete citation
undo/redo and human interaction still need the updated running artifact and UI.

The real native Termux Files component ran under the Android app UID and SELinux
domain. Listing, private-path rejection, PDF/video thumbnails, native SQLite and
the add-on health route passed; owned child processes exited. The single-frame
video seek edge case remains recorded. Evidence is in
`BashkittenBuild/verification/files-termux-20261028/native-termux-evidence.json`.
Native Termux Office engine/server compilation is still in progress; Files
success does not establish Office support on that platform.

The isolated native Linux gateway diagnostics exercised two project launches
sharing one Quantum process, native Pi editing/save/PDF export, project-scoped
References, managed citations, snapshot history/restore and stale-session
rejection. Backend shutdown removed its owned processes; reopening with
autostart disabled left heavy services stopped. Evidence is in
`BashkittenBuild/verification/apps-native-gateway-20261028/`. These are native
module/API diagnostics, not installed desktop/phone UI acceptance or real Tor
transport coverage. Mapped-origin browser forms and sockets are being checked
separately against the exact forwarded HTTPS origin.

References UI source now uses bounded uploads and paged range selection
(`508019e9eb`, `4beec00cb3`). Earlier available browser checks covered collection
navigation, metadata, classic citation controls and native reference import/export
with small local data. Bulk identifier resolution and a 100k-record benchmark
were not run. Same-machine native Zotero metadata/PDF parity, installed capture
and challenge flows, signed connector update/rollback, native browser TLS trust,
complete phone/desktop editing and final package acceptance remain open.

The authorized `office-builds` repository now builds Files and Office target
artifacts with ordinary Actions caches/uploads (`bb16c986ba` in the main source).
Development and early integration packages remain distinguishable from complete
release packages; missing native artifacts are not silently accepted by the
normal release collector. Hosted builds and the remaining architecture/runtime
coverage must still be recorded separately.

### Packaged iteration and native follow-up checkpoint

Linux, Termux and Android iteration packages have now passed build and package
checks at frozen browser revision `4be2563e5e`, version `153.5.2`. Exact paths,
hashes and the explicit `integrationIteration` designation are recorded in
`BashkittenBuild/verification/browser-integration-4be2563e5e.json`. These packages
include the independently installed module sources and capture boundary; native
Files/Office payloads were explicitly unavailable in that early iteration.
They are not complete release packages. Current module updates must retain their
own actual source and native artifact receipts rather than claiming the frozen
browser revision covers later changes.

Three independently sealed Files archives (Linux amd64 and Termux aarch64/x86_64)
passed the normal collector with source `12923eaccb`, `development: false` and
599 inventoried files each. Receipts are in
`BashkittenBuild/components/files/artifacts/sealed-receipts-20261028.json`.
The Linux Office development artifact includes the eight shared native patches
and full source/license inventory. The Termux port checkpoint is committed in
`09c02b18fa`; native Python/libffi, multiprocessing and shared-memory dependency
execution passed inside the Termux app. Full native Termux Office remains an
active compilation/runtime gate.

Updated native Office diagnostics now passed DOCX/XLSX/PPTX edits and citations
through whole-backend shutdown, restart and reopen. A fresh DOCX also passed
native insertion/edit undo and redo, preserving the expected occurrence ID,
locator, rendered text and metadata revision. The actual mapped HTTPS gateway
served editor forms, sockets, renewal and References requests at the forwarded
origin. Native export passed through the scoped normal-browser resolver and
returned a single-use PDF; an explicit text-citation copy had no active citations
while the master retained its citation. Evidence is under the existing
`apps-native-gateway-20261028` verification directory. Installed UI and actual
Tor/Chisel-route acceptance remain distinct and pending.

Fresh isolated installation preparation preserves the running host browser and
previous acceptance profiles. The dedicated Xorg VM has the new package. A
separate Android instance uses a fresh primary-user image with the prior image
preserved. These are setup results, not completed user-flow checks.

### Source, export and native-build follow-up

The earlier Files archive check covered payload inventory and source identity;
the subsequent full package license collector found incomplete dependency
notices. Final package assembly remains stopped. Exact upstream notices and
published SPDX declarations are being retained with their provenance, separately
from canonical license text. The three pinned Go dependencies without established
license coverage remain unresolved; licensed native replacements are under
review. No missing grant is inferred, and existing sealed artifacts are not
edited or relabelled. Evidence is in `verification/go-module-legal-20261028/`
and `verification/module-iteration-fa2-legal-check.json` under BashkittenBuild.

The earlier citation Undo result used the native `XUndoManager` API, not the
collaborative toolbar command. A subsequent `.uno:Undo` diagnostic found that
upstream UNO undo contexts had no document-view identity. The focused generic
patch assigns the current native document view while retaining collaboration's
ownership checks. It has compiled; same-view Undo and rejection from another
participant are being verified before claiming that command path works.

The native x86_64 Termux Office engine has compiled, including the shared Undo
patch. Online server dependencies/configuration and complete Android document
execution remain open. The ARM engine is still compiling. Dependency execution,
engine compilation and installed product acceptance remain separate results.

References exports now use bounded SQLite pages, a private input spool and one
native translator with its native file writer. Explicit selected, search,
collection, library and deleted-item scopes replace the earlier selection and
child-record ceilings. Focused native checks covered stale-version rejection,
cancellation, receipt recovery, 201 child notes and an 18.9 MB private download.
Formats that natively buffer a complete array/graph/document report that memory
behavior; no 100,000-record benchmark or mass provider retrieval was run.

Current native module/resource updates reuse the successfully compiled browser
boundary. The resource-only package refresh preserves its actual native binary
hashes and uses the normal source-revision checks; it is not a new full Gecko
build or a completed release package. Installed browser HTTPS, capture/update,
human/agent UI and full platform acceptance are still pending.

### Focused web UI and native server checks

The permitted in-app browser exercised the real standalone References service
with three local records. Whole-library and author-search RIS exports downloaded
three and one records respectively; their bytes and identities were checked.
The classic citation dialog displayed full creator names/year, multiple sources,
locators and manual source ordering. Native keyboard edits opened the regeneration
choice; keeping custom text, regenerating the APA citation and confirming with
Return passed. Evidence and screenshots are in
`verification/references-ui-20261028/`. This is independent web UI evidence,
not installed BashKitten TLS, capture or phone acceptance.

The export checkpoint `ee7cd40449` also fixes concurrent job reservation, saves
the versioned retry request before dispatch and preserves completed receipts on
late cancellation. Focused native diagnostics covered identical concurrent
requests, conflicting inputs, disconnect recovery, cancellation and archived
library exports. The normal archived-library write restriction remained active.

Shared native Undo patch `2ba8af2181` passed actual Writer commands from two
authenticated views: the owning view could Undo/Redo, while the other view was
rejected. Calc/Impress shape text and attributes exposed further native UNO Undo
gaps. A real active-shape check also reproduced an agent write being overwritten
when the human finished editing that shape. The focused native correction reuses
the existing undo factory and active-shape lock; its rebuilt runtime checks are
still pending. Full simultaneous editing is not yet accepted.

The native x86_64 Termux server and both kit launchers now compile/link, with
the normal capability, Landlock and seccomp configuration and upstream SBOM
check passing (`7c68da794b`). Earlier dependency probes used emulator serial
6520 under Termux UID 10123. New server/kit runtime checks target the separate
6522 instance, whose Termux UID is 10122. Keep those installations and evidence
distinct. Full document execution and ARM64 completion remain open.

Licensed native cache/logging/media dependency sources are retained in
`fa0c52d4b1`; their narrow adapters and complete Files build are being checked.
The obsolete unlicensed module archives are removed from current build/source
inputs while the original import remains recoverable in Git history. Final
package assembly still waits for the selected graph and artifact checks.

### Licensed Files and native Office follow-up

The Files dependency correction is committed in `8b4fa02c88`. Native Linux
amd64 and Termux aarch64/x86_64 builds passed with the selected licensed cache,
logger and media dependencies; their complete notices and linked module graph
were verified. Obsolete unlicensed archives are absent from current build and
source inputs. The normal final collector still requires a single coherent
source checkpoint before new accepted artifacts are sealed. Historical rejected
artifacts remain unchanged.

Shared native Office changes and both Termux server build inputs are committed
in `bbd5388fea`. The corrected native shape Undo implementation passed actual
`.uno:Undo`/Redo in Writer, Calc and Impress, restoring citation identities,
styles and metadata revisions. Another authenticated view was rejected by the
native collaboration ownership check. Copied bibliographies and unlink Undo/Redo
also passed. These are native module diagnostics, not installed toolbar checks.

The native active-shape guard rejects background text changes while a human is
editing the same shape; editing another shape and retrying after the human
finishes passed. Impress compound rollback was exact. Calc restored text and
metadata but moved a cell-anchored bibliography by 0.05 mm after an earlier cell
change and rollback, so all-target conflict preflight remains under investigation.
Native Calc cell input separately showed last-commit behavior with both UNO
setters and the ordinary EnterString command: a human's uncommitted input can
replace an agent's same-cell edit when the human commits. No separate cell-lock
system or stronger native guarantee is claimed.

Both complete Bionic engine/server builds and their upstream SBOM checks passed.
The new runtime diagnostic uses Android instance 6522, Termux UID 10122. ADB's
copy did not preserve executable modes and app-labelled symlinks; extracting the
verified artifact through the actual app UID repaired that setup problem without
changing SELinux policy. First Office startup then exposed a real launcher
boundary issue: native Office library paths were applied to the Node launcher
itself. Restricting those paths to its native children is being fixed and tested.
Successful native document execution on Termux remains unverified.

## Decision and planning work

The user selected Collabora Online after the temporary stock-server comparison. The active plan, AGENTS instructions and current native
plan amendment now cover Collabora, a maintainable external Quantum add-on,
light UI/document canvas and the immediate Android chat-height/browser-boundary
iteration build. The frozen original native plan/tag is unchanged. No browser
or backend integration build was dispatched for this documentation change.

## Temporary comparison evidence

Both stock services ran on the same Linux host, outside the repository. User
sample XLSX/PPTX/DOCX files were copied from Downloads, not edited in place.

| Component | Observed identity / memory snapshot |
| --- | --- |
| Collabora CODE | `26.04.5.2.1`, reported Online/kit hash `42745e44dd`; server 745.4 MB |
| Temporary Collabora file host | Separate SDK-derived WOPI test host, 78.4 MB |
| Collabora combined | About 823.8 MB |

Measurements are decimal container/service memory accounting, excluding browser
memory, with differing active documents/sessions. They are not matched-workload
RSS/PSS/peak benchmarks, not a fourfold guarantee and not native Termux results.
The CODE image digest observed was
`sha256:808410e77b8695a35b93c7638fbba07c10cf0ba8307141b460248f18ab6e5c55`.
This observation does not establish a source-complete distributable package pin.

Verified locally: Collabora displayed the BCT spreadsheet and saved a blank-
document edit through the temporary WOPI host. The user reported successful
Collabora use on the devices used for the comparison. Full installed-product
mobile acceptance, controlled performance testing and native Termux verification
remain pending. Earlier comparison observations remain in Git history.
The temporary host is not the planned production Quantum add-on and does not
prove its locking, history, source policy, authentication or lifetime acceptance.

## Research baseline before implementation

The following records the original source investigation; subsequent work and
remaining acceptance are tracked in the implementation checkpoints above.

- Released Collabora `cp-26.04.5-2`, commit
  `42745e44dd8530fac7acd5f46cb7571ceea63c6a`, contains native document WebSocket,
  UNO/script and experimental JS extension facilities. Complete Pi browserless
  live-edit/save/export/coedit acceptance is pending.
- Native history invokes a host UI/storage contract. The full-version store and
  minimum host chooser/restore adapter remain to be implemented.
- Writer's native Zotero integration has cloud-specific behavior, excludes
  small-screen initialization and is not a full local References or Calc/Impress
  solution. Full citation scope remains required.
- Quantum's pinned stable lacks Collabora, but upstream development has WOPI
  source and a signing correction. Reuse those pinned sources within the user's
  separately versioned add-on boundary; the module/hook is not implemented.
- Native light launch defaults and WOPI browser-background settings exist. A
  runtime always-light policy covering Interface Settings and all native toggles
  still needs implementation/verification; no document recoloring is permitted.
- Native Bionic Termux `coolwsd`/kit/engine operation remains unproved. The Android
  standalone app and Linux container do not establish this capability.
- Android's excessively tall default chat/message area is a reported regression;
  its root cause/fix is not established by inspecting the existing CSS alone.
