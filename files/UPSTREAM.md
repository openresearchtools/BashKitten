# Source and upgrade contract

| Boundary | Exact source | License |
| --- | --- | --- |
| Native Files | Quantum `v2.0.2-stable`, `2c071d1e6eb48d4b88da2657885d345663a0a88b` | Apache-2.0 |
| Extracted native WOPI | PR 3108 introduction `c5112cd51c8479c21cfca49e376cd207242c2595`, signing fix `fd64a470d3a521b0ad026f0f5307c20dd04b472f` | Apache-2.0 |
| Native Office policy patch | Collabora `cp-26.04.5-2`, `42745e44dd8530fac7acd5f46cb7571ceea63c6a` | MPL-2.0 |
| JWT | `github.com/golang-jwt/jwt/v4 v4.5.2` | MIT |

`vendor/quantum/source` is the pristine selected release. Its complete recursive
Git blob inventory was checked against the archive, including ignored upstream
embed placeholder and SQLite fixtures. The imported source is unchanged.
`vendor/quantum-wopi/source` preserves the exact selected donor files and module
locks; it is not a moving branch or an additional modified Quantum tree. Each
import has source metadata and per-file SHA-256 manifests.

The donor's discovery XML parser/editor URL construction, JWT HMAC validation and
lock-table operations are retained in `addon/wopi_*.go`. Native dispatch is
adapted to a private owner callback because upstream globals couple it to the
Quantum users/files store. Added host duties are native RSA proof validation,
live grant/generation/participant checks, complete atomic file publication,
locked-save enforcement and native settings/extension delivery. Upstream token
issuance does not replace BashKitten authorization. OnlyOffice handlers remain
unaltered in the pristine native Files build.


The 29 October native Options bridge uses the pinned Collabora
`Map.Settings.ts`, `AdminIntegratorSettings.ts`, `Xcu.ts`,
`FileServer::fetchWopiSettingConfigs/uploadFileToIntegrator` and
`DocumentBroker` preset protocol, without changing those pristine sources.
The authenticated launch supplies `wopi_setting_base_url`; the existing private
owner stores browser JSON, the fixed native `documentView.xcu` and native
`viewsetting.json`. The three native Settings POST routes accept only an already
issued document bearer token belonging to the existing cookie grant. Their
bounded multipart data must name that owner's exact settings base/document/file
and the same token; only that validated token reaches Collabora. Other routes
retain the existing Authorization stripping. Kit `registrymodifications.xcu` uploads merge into the same
XCU. Native Options owns all controls and native LibreOffice applies the values.
The adapter accepts only the native apply/upload subset of XCU property paths,
including its ancestor containers, and rejects unsupported container operations,
XML directives/external entities, unknown uploads and oversized files. It does not
execute XML or fetch URLs from preference contents.

Native Options sends its complete UI subset while kit shutdown can send partial
registry modifications. A bounded property merge preserves omitted native
settings; the seven selected English Lightproof flags are seeded only when
absent. Native presentation modes retain their 100-document timestamped bound.
Compare-and-save retries preserve unrelated concurrent properties, while edits
to the same option retain native last-writer behavior. Content hashes invalidate
native preset caches. External Office AI stays disabled. User preferences use
the existing verified local or exact remote-username principal, namespaced and
hashed with the environment ID; cookie/grant rotation does not reset them.
Every access still rechecks the document grant through the existing owner.
Only the currently authorized participant's old browser settings may migrate
when the stable owner has none; unattributable legacy files remain untouched.

`patches/quantum/series` contains the scoped launch/provider seam, configurable
request budget, native locally packaged Ace assets and licensed dependency imports.
The native mutation receipt patch reports actual scoped destinations after
auto-renaming, preserves request positions in partial batches, and advertises
that contract through authenticated `OPTIONS /api/resources`. Native file copy
reuses its existing byte-copy routine with upload-style temporary publication;
source deletion finishes before a move is reported complete. Registered target
observers receive bounded, exact publication receipts, including partial folder
copies and the explicit source-removal failure phase. Successful moves carry
request-local observers to their actual destinations before later batch items.
The host rejects an older
binary before mutation and never performs the filesystem move itself.
Copy traversal also honors the native source's configured `IgnoreAllSymlinks`
policy for nested source and destination paths, rejecting links visibly and
opening source files without following links on the Linux/Termux targets.
`patches/collabora/series` contains only the proven missing
locked-light preference hook. Adaptation is applied to an external build copy.
Updates must apply with zero fuzz; do not edit pristine source to make a patch fit.
Remove our provider hook if a later selected upstream release offers the same
replaceable boundary natively.

Files branding uses the selected release's native `frontend.name`, description,
favicon/login icon, external links, background colors and `customCSS` facilities.
The artwork is the existing BashKitten image; the neutral light/dark palette and
typography match the browser's current settings/Agent owners. Seasonal decoration
and upstream release links are disabled through native configuration. The native
external link opens a small offline About Files page within the existing scoped
gateway, with the complete unchanged Apache license and packaged notice inventory.
Upstream names appear there as source attribution, not as this modified product's
name. Apache-2.0 sections 4 and 6 retain copyright/license/change notices and do
not grant upstream product marks. No separate trademark policy was present in the
pinned source; this is not a claim that any broader mark permission was granted.
The small metadata patch covers only two gaps in native configuration: the fixed
Apple installation title and three hardcoded upstream canonical URLs. It reuses
the configured name and removes the irrelevant canonical tags. Retire it when
upstream's branding owner supplies those behaviors. The original source/license,
source manifests and all other notices remain unchanged.

`vendor/dependencies/sources.json` binds the exact Quantum Go/npm lockfiles to
92 Go modules and 460 npm package archives, including target-specific optional
packages. Go module sums and npm SRI values are preserved, as are archive hashes
and original notice filenames. `native-sources.json` records separately selected
MuPDF 1.28.2/FFmpeg 9.0.2/dav1d 1.5.4 source, native build tools and the upstream FFmpeg recipe.
Downloaded archives live in the external `BASHKITTEN_SOURCE_CACHE`, selected by
their original HTTPS URLs and exact checksums; they are not committed to Git.
Historical split-part manifests remain provenance for reconstructing and
verifying existing cache seeds. `BASHKITTEN_OFFLINE_SOURCES=1` requires a warm
verified cache. Normal corresponding-source artifacts include the complete
selected original archives and notices, including native frontend build-tool
sources for esbuild and Rollup; download links alone are insufficient. Product
MuPDF/FFmpeg are compiled from source. Pristine imports, full licenses, pins and
named patches remain tracked. Ordinary Actions caches/artifacts supply build
storage, with no GHCR publishing.

The original Quantum dependency graph includes three module versions without
usable licensing terms. `runtime-go.json` selects the separately imported,
licensed native replacements from `licensed-go-sources.json`; it never assigns
new terms to the original archives. Their obsolete ZIP/mod/info inputs are
removed from the current source tree and source bundles. The preserved baseline
manifest identifies those inactive hashes; downloaded ZIP wrappers fall within
the user's separately inventoried history cleanup. Pristine Quantum source and
the original manifest remain preserved, while the active selection only reads
the replacement archives. The named dependency patch routes the
existing cache/logger calls through narrow typed/configuration facades to
patrickmn/go-cache 2.1.0 and Logrus 1.10.2. Native TTL, sweeping, synchronization,
formatting and output stay in those libraries. go-ffmpeg 1.0.0 retains its native
shared service and semaphore; redundant outer slot acquisition is removed. Its
unused gtlogger adapter and dependency are omitted by a separate subset patch.
The second FFmpeg patch selects its existing file-only ffprobe capability gate
for an explicitly local `StreamFile` request. The native generic stream gate
otherwise requires TCP even for local metadata; network stream gates remain
unchanged and our FFmpeg build keeps network protocols disabled.
Pristine sources stay unchanged. Prepared and actual linked Go inventories must
prove the selected versions and absence of the original cache/logger modules.

`notice-sources.json` records checksum-bound supplementary notices. Original
upstream text and declared SPDX evidence are distinguished. The latter requires
an exact name/version/license declaration in the published package metadata and
retains the pinned canonical template without inventing copyright attribution.
Missing declarations cannot use that route. Legal provenance is included offline
and reused from existing shared owners where the exact source/version matches.

Native Termux reuses the exact framework/NDK pins in
`agent/packaging/node/lock.json`, the external verified cache and the shared
packaging toolchain owner. Retained LLVM corresponding source and its inventory
remain under `agent/vendor/node/libcxx`. Only relevant
upstream native patches are applied with zero fuzz; exact patch/archive/compiler
hashes are recorded in target metadata. Go runtime provenance and full notices
reuse `auth/dependencies/go-toolchain`'s exact 1.27.2 source pin.

Before an upstream update is accepted, repeat these focused external contracts:

1. Verify exact commit/archive inventories, full notices and every dependency
   checksum. Inspect actual native configuration/API/extension facilities again.
2. Apply the named patch series with zero fuzz, compile native frontend/Go/Office
   code, and inspect final executables, payload, notices and traffic.
3. Exercise native non-admin proxy login, explicit source permissions, private
   files/links and bulk-operation denial, two simultaneous scoped tabs, source
   reconfiguration draining, and one-process lifecycle through real Caddy HTTPS.
   Verify actual auto-suffix receipts, ordered partial batches, atomic overwrite
   failure, source-removal failure and registered-child publication receipts;
   moves retain document identities, while copies and overwritten identities
   retain their separate history/authorization boundaries.
4. Verify proof rejection/rotation, independent human/Pi identities on one broker,
   all six formats, native edit/save/Save As/export, lock conflicts, interruption,
   permission revocation, durable save/version reconciliation and restart recovery.
5. Verify immutable history opening, native pre-restore broker acknowledgement,
   new-view exclusion and old-generation rejection, retention/deduplication and
   actual light UI/canvas runtime settings without changing authored colors.
6. Verify native extension loading and References cancellation/origin/project
   binding. Repeat native Linux/Termux and installed ordinary-browser flows.

Tests and diagnostic documents run outside the repository. Source/build/module
checks do not establish installed product acceptance or replace the plan.
