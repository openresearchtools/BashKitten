# Files and the Office host boundary

This separately versioned module configures **File Browser Quantum 2.0.2-stable**
and provides the WOPI responsibilities missing from the owning backend. It does
not implement an Office editor. `../office/` owns native Collabora processes,
kit/UNO sessions and the replaceable References extension. The backend's existing
HostedServices owner starts one Quantum and one Collabora instance per environment.

`provider.mjs` returns a native service definition and proxies the authenticated
ordinary Files tab. `office-provider.mjs` owns the document launch registry,
private callback server and native editor proxy. `storage.mjs` stores real project
files and private snapshots. `addon/` is the extracted upstream Go WOPI protocol
boundary, with a private Unix endpoint and no process supervisor. Module interface
version is 1; installation requires matching native artifacts.

## Native facilities used

- Quantum proxy authentication creates ordinary users. Native user APIs reconcile
  explicit source scopes/permissions; the reserved bootstrap administrator never
  becomes a browser account. Native access APIs deny private paths in addition to
  native index rules. Native branding configuration supplies the BashKitten icon,
  name, dark/orange CSS, disabled seasonal decoration and disabled account settings.
- Actual canonical project folders are native sources. `createUserDir` is false;
  database/cache are private under the owning data directory. No synchronized copy
  or per-project server exists. A broad home source can list its allowed content;
  recursive operations containing private state are refused.
- The only Quantum editor seam is the named, optional document-provider hook for
  six Office extensions and native browser PDF viewing. The separate scoped-prefix
  hook uses only trusted headers on a private Unix listener. OnlyOffice is untouched.
- Collabora owns shared document brokers, distinct participants, cursor presence,
  autosave timing, native locks, save/export/Save As, kit workers and editing APIs.
  The add-on adapts the audited upstream WOPI implementation rather than adding a
  second collaboration or document conversion service.
- Native `UI_FileVersions` invokes the host's bounded snapshot list. Restoration
  is delegated to `coordinateNativeRestore(documentId,{grant,signal})`, which must
  issue native `versionrestore prerestore` and await the broker's actual
  `close: versionrestore: prerestore_ack`. Browser assertions cannot authorize a
  restore. New view admission is held off during restore; old-generation writes
  fail afterward. Immutable versions use separate native WOPI identities.
- Native `UserSettings` publishes browser preferences and the replaceable extension
  ZIP. Native `ui_defaults=UITheme=light;SavedUIState=false` sets launch policy. The
  isolated Collabora patch adds `LockedUITheme=light` at its existing preference
  and UI-manager owners because the release's runtime settings can otherwise
  reactivate dark UI/canvas. Authored document colors are never transformed.

## Trust and storage contracts

The backend supplies canonical scope/root, identity, live permissions and
`authorizeOperation(grantId,operation,work)`, invoking `work(scope,signal)` inside
its existing auth/revocation/drain owner. `authorizePath(path,{tree})` rejects
private paths and link aliases. No browser header or request body supplies those
trusted values. All `x-bashkitten-*`, cookies and authentication headers are removed
before forwarding explicitly selected native identity fields.

Browser URLs are absolute HTTPS through the existing Caddy/trust/tunnel owner.
Native Collabora has one fixed `/apps/office` service root. Its requests resolve to
an issued native token/WOPISrc and the exact captured live gateway grant. Cookies
only select among registered sessions; document operations need their native
identity. Remote human reopening creates a new authorization and participant,
never adopts a local Pi view. Pi uses the separately returned private native URL.
Native exports are registered by the trusted Office service through
`registerExport(...)`. Its exact issued WOPISrc/download identifier becomes a
scoped ordinary browser URL that the existing resolver can map to a fresh human
grant. The host rechecks download permission and streams Collabora's native
single-use export; it stores neither a second export file nor an agent token in
the browser URL. Alias URLs share the same consumption state.

WOPI files/locks/writes require the scoped expiring JWT **and** native RSA proof.
A proof-verified native broker may release its exact matching lock after grant
revocation; this cleanup cannot read/write content or finalize revoked snapshots.
Active views renew their scoped tokens through native `Reset_Access_Token` /
`resetaccesstoken`, preserving the broker and participant. Renewal rechecks the
live owner and original document generation.
The native preset downloader does not sign requests in this pinned release:
only read-only browser-settings/extension GETs omit proof, while retaining JWT,
current grant and generation checks. That exception cannot read a project file.
The fixed extension artifact must match its SHA-256 and size bound. Proof keys
come from native discovery and the native generated persistent private key.

Complete saves are streamed into private recovery storage, length/digest checked,
re-authorized and published by a same-directory atomic rename. Retry reconciliation
uses both digest and current file fingerprint. Initial/native-save/final-unlock
checkpoints retain full snapshots approximately every five minutes, maximum 50,
under `office-sessions/` outside projects. No background snapshot timer exists.
Save As uses exclusive publication and cannot overwrite another open document.
Rename and Save As retain private receipts for interrupted publication. Uncertain
or revoked saves retain their recovery material; restart does not adopt old grants.

`configure({collaboraInternalURL,wopiURL,extension})` initializes the singleton
provider before its first native session. Endpoints/artifacts cannot be retargeted
while prepared or in use. `snapshot(...)` only resolves a registered retained
version under current view/download authorization and works without starting
Collabora; private filesystem descriptors never belong in browser/Pi responses.

References dialog requests use a typed postMessage bridge bound to the exact
native extension frame, origin and nonce. Credentials remain host-side. Requests
are project-bound, bounded and cancellable on cancel/replacement/page closure.
The Office settings route only accepts the citation regeneration preference;
broader library settings remain in the References manager. The host canonicalizes
native URL aliases before the existing gateway checks the captured project.
The explicit export-with-text-citations action uses that same frame/nonce and
request cancellation owner. The host captures the document and browser view,
then calls the existing native Save As/citation-unlink operation. The frame can
choose only a plain output filename and one of the six supported Office formats.

## Build and package

`python3 files/build.py --work-dir /absolute/external/build --prepare-only`
verifies and materializes the locked sources, applies the named Quantum patches
with **zero fuzz**, and never writes into pristine imports or downloads anything.
Linux builds use `--target linux --architecture amd64|arm64 --go <Go1.27.2>
--output <artifact.tar.gz>` on matching Ubuntu 24.04 runners. Hosted Termux builds
use `--target termux --architecture aarch64|x86_64 --ndk <NDK-r30>
--ndk-archive <verified-archive> --go <Go1.27.2> --output <artifact.tar.gz>`.
The existing `agent/packaging/termux/native_toolchain.py` owns NDK validation and
Bionic compiler/sysroot isolation. The retained framework supplies only its
required MuPDF signal/temp-path and FFmpeg temp-path adaptations. Native Quantum's
`cgosql` option selects its existing SQLite implementation for Android. Target
ELF machine, Android linker and complete native library closure are checked;
this cross-build does not execute target binaries or establish device acceptance.

Node/npm, Python, Make, Meson/Ninja and pkg-config are host build tools. On x86,
NASM is built for the host from its preserved source. Target libraries never use
host pkg-config paths. Go must match the existing retained 1.27.2 compiler/source
pin; full standard-library notices accompany its linked runtime. Use separate
external work directories for each target and architecture.

The selected native media recipe builds MuPDF 1.28.2 and its included third-party
source, FFmpeg 9.0.2 with native codecs plus dav1d 1.5.4 and zlib, and native static
libraries. It does not consume go-fitz's bundled prebuilt MuPDF archives or a
container image. FFmpeg optional external hardware/codec/filter libraries are not
automatically detected from the build host; the selected capability set and
platform behavior require native acceptance. The audited upstream FFmpeg recipe
is retained as reference, including its broader decode-profile flags.

Frontend dependencies are installed from exact preserved npm tarballs with
`--offline --ignore-scripts`; registry integrity and our SHA-256 are both retained.
The Go proxy is rebuilt from preserved `.zip`, `.mod` and `.info` files, with
network/toolchain download disabled. Quantum analytics publishing is compiled out
using its native default `!analytics` build; native update checks are disabled.
No registry-image publishing or cache service is used.

The native artifact root contains `bin/`, `legal/`, `sources/`, `licenses.json`
and `manifest.json`. Full notices use the shared runtime license-record format. `depends` contains
actual OS package dependencies; `sourceDependencies` holds preserved source pins.
`notices.py` checks complete notice text before native compilation. Named
supplements bind original README/header notices and exact upstream legal files
to checksums. Where published metadata explicitly declares an SPDX identifier,
the inventory separately labels the retained declaration and matching pinned
canonical text; it does not invent copyright attribution or an upstream license
file. A dependency with neither usable original terms nor an explicit declaration
blocks artifact sealing. The shared main-package collector retains its own check.
Linux packaging requires Ubuntu 24.04 and inspects the actual ELF dependency/ABI
closure. `SHA256SUMS` accompanies the artifact. Every payload file has a checksum; the manifest binds target,
architecture, upstream pins, patch hashes and the committed BashKitten revision.
Accepted packaging requires committed module source unchanged throughout the build. Runtime JS/web files are
collected separately and cannot be overwritten by the native artifact. Pristine
upstream tests and imported archives are source material, never product fixtures.

See [UPSTREAM.md](UPSTREAM.md) for pinned-source/update discipline and
[STATUS.md](STATUS.md) for actual evidence and outstanding coverage.
