<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Firefox ESR updates and BashKitten versions

BashKitten follows Mozilla's Firefox ESR release line. The exact official tag,
commit, and version remain in `browser/bashkitten/upstreams.toml` as provenance;
`source_commit` identifies our compact pristine-source commit and `source_tree`
is the unchanged official Git tree. Upstream
`browser/browser/config/version*.txt` files retain Mozilla's values. The application
version lives in `browser/bashkitten/config/version.txt` and is used for the browser's
version display, native command output, application metadata, and package names.
Gecko's milestone, compatibility version, and ESR build settings stay tied to
the Firefox base.

| Firefox base | BashKitten release | Meaning |
| --- | --- | --- |
| 153.2.0esr | 153.2 | First release on Firefox ESR 153.2 |
| 153.2.0esr | 153.2.1 | Next BashKitten release on the same base |
| 153.2.0esr | 153.2.2 | Another BashKitten release on the same base |
| 153.2.1esr | 153.2.3 | Mozilla hotfix incorporated into the next product release |
| 153.3.0esr | 153.3 | New Firefox minor version resets our final number |

The final BashKitten number counts product releases. It does not encode the
Firefox hotfix number; the separate exact upstream pin provides that detail.
This avoids reusing or decreasing a product version when Mozilla publishes a
hotfix after BashKitten has already shipped several releases.

## Check the upstream base

```bash
python3 browser/bashkitten/scripts/firefox_release.py check --latest
```

This verifies local version consistency, the compact source tag/tree and its
ancestry, then checks the official tag's original SHA and the newest release
in the current ESR major without fetching upstream history.
It exits unsuccessfully if a newer release is available. It does not modify the
checkout. Run this before preparing a release; it requires network access and
the complete compact product history. The ordinary build uses `check --versions-only` so a pinned
build stays reproducible and can run from a shallow checkout without network
access. The release manifest records both product and Firefox versions.

## Incorporate an upstream release

Run these commands from the outer BashKitten repository root. Start with a
clean, committed product checkout:

```bash
python3 browser/bashkitten/scripts/firefox_release.py update 153.4
```

The tool resolves the exact official tag, then downloads only that release
using a depth-one fetch in a temporary bare repository. It verifies the fetched
SHA and copies only the source tree and blob objects into BashKitten, preserving
all file bytes, executable modes and symlinks. The native commit, tag and shallow
metadata are discarded with the temporary repository. No Mozilla history is
fetched into the product repository, and no archive is extracted.

It creates one pristine-source commit whose only parent is the previously
pinned `source_commit`, tagged under `bashkitten/firefox/` followed by the exact
official tag name. Its tree is the official tree; its message records the
original tag and SHA. Do not create native `FIREFOX_*` tags or fetch Mozilla
branches into BashKitten: that would restore the history deliberately removed
at the Firefox 153.0 baseline.

The tool prepares a real three-way `ort -Xsubtree=browser` merge from this source
commit, retaining product changes and surfacing conflicts. Firefox changes stay
inside `browser/`; it refuses to finish a merge that stages files outside that
prefix. It updates the official provenance, compact-source pins and product
version together and stages them with the upstream changes.
It does not commit, push, publish, or run tests. Review the staged changes,
validate the browser on GitHub Actions, and commit the merge when ready. The
internal source tag must be pushed with the product merge. Keep that compact
merge ancestry; release validation checks the recorded source commit, not the
original Mozilla commit, as an ancestor.

If the merge conflicts, resolve and stage the affected files, then finish:

```bash
python3 browser/bashkitten/scripts/firefox_release.py finish 153.4
```

Use the full Firefox version for an upstream hotfix, for example `153.3.1`.
A new ESR major must be chosen explicitly; `check --latest` follows the current
major until that migration is made. Review the new major's compatibility,
toolchain, and product integration changes before releasing it.

## Release BashKitten changes on the current base

```bash
python3 browser/bashkitten/scripts/firefox_release.py bump
```

From a clean checkout, this changes `153.2` to `153.2.1`, or `153.2.1` to
`153.2.2`. Commit the version change with the product release. It leaves the
Firefox tag, commit, and engine version unchanged. Browser archives, Debian
packages, and AppImages inherit the product version from the normal build.

The compact history starts from the exact Firefox 153.0 source snapshot and
retains subsequent ESR/product work. Earlier Mozilla and imported dependency
ancestry is not retained. Original donor revisions and upstream URLs remain
recorded in `browser/bashkitten/upstreams.toml` for provenance, alongside their
licenses; those original SHAs need not be local ancestors. Uncommitted donor
files were not imported.
The source root for `mach` is `browser/`; repository metadata remains in the
outer `.git`, with no nested repository or submodule. Use `--versions-only` for
shallow build checkouts and the complete compact history plus internal source
tags for ESR update operations. Source downloads use temporary disk space next
to Git's object database and are removed on success or failure.

## Android security backports and security data

After each ESR update, also compare Tor Browser's release on the **same pristine
Firefox tree**. Its Android backports can contain fixes that are not in Mozilla's
ESR Android source. Do not merge a Tor branch or substitute a Firefox release
branch. Inspect each production patch, its prerequisites and our overlapping
changes; preserve upstream copyright and record exact commits in
`upstreams.toml`. Carry these patches forward until the ESR source includes them.
Native Tor is a separate component pinned in `auth/upstreams.lock.json`.

The 6 October 2026 comparison used [Tor Browser 16.0a13](https://blog.torproject.org/new-alpha-release-tor-browser-160a13/)
and the exact tag/commit/tree recorded in the manifest. Fifteen production
backports were included (not fifteen distinct CVEs). They cover Android download
and permission prompts, content-channel validation, hardware-buffer ownership,
WASM collection, layout caching, cloned RegExp validation, resource URI lookup,
about:config handlers, upload field names and orientation behavior. The Windows
orientation follow-up `3126ad57cab0a58d93cd55021a7a5f43ab28127a` and rumdl packaging
change `189176e6bc1153184e91764178b5128a5e53fd95` do not affect our shipped targets
and were excluded. No upstream test code was changed or claimed to have run.

Two patches required product-specific integration:

- Bug 1842361: preserve BashKitten's existing `shouldSkipConfirmation` callback
  while adding the upstream dismissal callback to both browser and extension
  download dialogs. Dialogs now dismiss when their originating tab changes.
- Bug 2053320: remove the `HomeActivity` Nimbus intent-tooling entry point.
  BashKitten already returns `NimbusDisabled`, so do not add Mozilla's replacement
  QA broadcast receiver or enable experiments. The security-sensitive entry
  point is removed without introducing a feature we do not ship.

Relevant Mozilla advisories include [MFSA 2026-73](https://www.mozilla.org/en-US/security/advisories/mfsa2026-73/),
[2026-74](https://www.mozilla.org/en-US/security/advisories/mfsa2026-74/),
[2026-82](https://www.mozilla.org/en-US/security/advisories/mfsa2026-82/) and
[2026-97](https://www.mozilla.org/en-US/security/advisories/mfsa2026-97/).
This comparison is not a claim that every Firefox release fix is present in ESR,
or that BashKitten has Tor Browser's complete anonymity configuration.

Both Android and Linux load the shared `99-bashkitten.js` preferences and
`BashKittenSettingsPolicy`. They enable signed OneCRL, CRLite, intermediate
certificate, extension/graphics blocklist and anti-tracking data updates, following
[Waterfox's security-data policy](https://www.waterfox.com/docs/policies/privacy/#security-data).
Gecko retains signature verification, attachment integrity checks and its normal
update scheduling. Only the explicit security collections may sync or download
attachments; Nimbus, studies, telemetry, Google Safe Browsing and the extension
store remain disabled. CRLite enforces revocations with Gecko's platform channel
(`compat` on Android, `default` on Linux); existing platform OCSP behavior is
unchanged. These background list requests disclose the client's IP to Mozilla's
Remote Settings/attachment/signature servers, not visited URLs or file contents.

The user's 17 October 2026 clarification retains this security-only boundary:
certificate and blocking-data services are permitted, while Sync/accounts,
profile backup, telemetry, studies and unrelated Mozilla product services are
not. The shared preferences disable the backup service's startup, scheduler,
archive and restore controls; disabling upload alone would still initialize its
idle measurements. Direct Remote Settings sync and attachment entry points must
apply the same collection policy as the normal polling path. Keep packaged and
cached security data, signature verification and normal certificate checks.
Do not clear security endpoints or replace missing records with invented data
to hide startup errors. Fresh installed-profile startup and request observation
must distinguish authorized security traffic from prohibited service traffic;
syntax/source checks do not establish that acceptance.

GMP media provisioning is separate from those security-data updates. The shared
policy defaults each supported plugin's `media.<plugin>.autoupdate` to false,
while preserving the native Automatic Updates choice in `about:addons`. The idle
installer skips its manifest and Chromium checks when no visible enabled plugin
allows automatic updates; the provider's periodic check honors those default
preferences too. Explicitly enabling automatic updates still works. EME,
decoders, passkeys and existing installed plugins remain available. The native
DRM enable/missing-CDM path requests an on-demand install independently of its
automatic-update choice, and manual plugin updates retain the upstream download,
certificate, signature and artifact verification path. Do not replace these
hooks with the upstream `media.gmp-manager.updateEnabled` kill switch, which also
disables explicit setup. On-demand media and explicitly enabled automatic updates
can still use the upstream servers; fresh startup without browsing or media must
not provision plugins. Installed fresh-profile traffic, explicit setup and saved
automatic-update choices still require acceptance.

The new-tab wallpaper feed also applies the attachment policy before resolving
server metadata or broadcasting image URLs: its content CSS loads those URLs
directly, outside the Remote Settings attachment downloader. For this offline
collection, retain the packaged solid colors and local custom-image upload,
rendering and removal controls, but omit remote catalog images/thumbnails.
Keep saved choices and files, the packaged catalog and its attribution. Do not
disable the entire wallpaper feed or master switch, or alter XFCE wallpaper.
Installed acceptance must cover fresh and retained profiles, local customization
and absence of wallpaper metadata/CDN requests separately from permitted
security requests.

Build and manual acceptance must cover both Android architectures and both Linux
architectures. On Android check that changing tabs dismisses download prompts,
immediate taps cannot approve fresh permission/download prompts, and ordinary
browser tabs remain usable while remote login or any backend service fails.
The native login path and its validation status are in
[`docs/android-agent-login.md`](../../docs/android-agent-login.md).
