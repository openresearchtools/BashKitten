<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Firefox ESR updates and BashKitten versions

BashKitten follows Mozilla's Firefox ESR release line. The exact upstream tag,
commit, and version remain in `browser/bashkitten/upstreams.toml`; upstream
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

This verifies local version consistency and the pinned tag's ancestry, then
checks Mozilla's release tags for the newest release in the current ESR major.
It exits unsuccessfully if a newer release is available. It does not modify the
checkout. Run this before preparing a release; it requires network access and
a full Git history. The ordinary build uses `check --versions-only` so a pinned
build stays reproducible and can run from a shallow checkout without network
access. The release manifest records both product and Firefox versions.

## Incorporate an upstream release

Run these commands from the outer BashKitten repository root. Start with a
clean, committed product checkout:

```bash
python3 browser/bashkitten/scripts/firefox_release.py update 153.3
```

The tool fetches the exact release tag from the pinned Mozilla remote, checks
its version files, and prepares an `ort -Xsubtree=browser` Git merge. Native
Mozilla commit IDs and ancestry stay unchanged; Firefox changes stay inside
`browser/`, and the tool refuses to finish a merge that stages files outside
that prefix. It updates the upstream pin and
product version together and stages those files with the upstream changes.
It does not commit, push, publish, or run tests. Review the staged changes,
validate the browser on GitHub Actions, and commit the merge when ready. The
exact release tags provide the upstream baseline; no permanent Mozilla branch
or other upstream branches are fetched or created. Keep the merge history:
release validation checks that the exact Firefox release is an ancestor.

If the merge conflicts, resolve and stage the affected files, then finish:

```bash
python3 browser/bashkitten/scripts/firefox_release.py finish 153.3
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

The initial subtree import retains the committed Android donor and its desktop
ancestor. Their exact revisions and upstream URLs are recorded in
`browser/bashkitten/upstreams.toml`. Uncommitted donor files were not imported.
The source root for `mach` is `browser/`; repository metadata remains in the
outer `.git`, with no nested repository or submodule. Use `--versions-only` for
shallow build checkouts and full ancestry plus the recorded release tags for
ESR update operations.
