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
