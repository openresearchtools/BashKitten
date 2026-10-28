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

`patches/quantum/series` contains the scoped launch/provider seam, configurable
request budget, native locally packaged Ace assets and licensed dependency imports.
`patches/collabora/series` contains only the proven missing
locked-light preference hook. Adaptation is applied to an external build copy.
Updates must apply with zero fuzz; do not edit pristine source to make a patch fit.
Remove our provider hook if a later selected upstream release offers the same
replaceable boundary natively.

`vendor/dependencies/sources.json` binds the exact Quantum Go/npm lockfiles to
92 Go modules and 460 npm package archives, including target-specific optional
packages. Go module sums and npm SRI values are preserved, as are archive hashes
and original notice filenames. `native-sources.json` records separately selected
MuPDF 1.28.2/FFmpeg 9.0.2/dav1d 1.5.4 source, native build tools and the upstream FFmpeg recipe.
Archives over 32 MiB are split byte-for-byte: concatenate the ordered `parts`,
verify each part and the joined hash before extraction. Sources/notices are
preserved intact, including native binary packages used only by frontend build
tools; product MuPDF/FFmpeg are compiled from source. Full native build-tool
source archives for esbuild and Rollup accompany their npm packages.

The original Quantum dependency graph includes three module versions without
usable licensing terms. `runtime-go.json` selects the separately imported,
licensed native replacements from `licensed-go-sources.json`; it never assigns
new terms to the original archives. Their obsolete ZIP/mod/info inputs are
removed from the current source tree and source bundles; the pristine originals
and original manifest remain recoverable in Git history. The preserved baseline
manifest identifies those inactive hashes, while the active selection only reads
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

Native Termux reuses the already retained framework/NDK inputs under
`agent/vendor/node` and its shared packaging toolchain owner. Only relevant
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
