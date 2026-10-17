# Offline Android dependency notices

`../../scripts/about-assets.py` resolves the Gradle OSS license plugin's URL-only
records through `sources.json`. No license downloads run during the build. The
resolved Maven coordinate set, metadata, full texts and hashes are checked before
About assets are generated. Unknown URLs or changed dependency versions require a
new review; empty text and HTTP error responses fail preparation.

The inventory preserves each original URL, POM license declaration and exact
component version. The retained POMs are the metadata resolved for this Android
dependency set. Exact matching source JAR legal files supplement canonical grants,
including embedded third-party notices. AndroidX/Apache declarations are not used
to infer the licenses of unrelated components. Google SDK, Play Core and Integrity
terms retain their own published full terms and referenced Google API terms.

The AppServices 153.0 and Glean 67.3.2 notices are resolved against their exact
release Cargo locks, not the separately retained Desktop AppServices tree. Crate
archives are verified against those locks before extracting their licenses;
authors, versions and declared license expressions remain in each notice. Where
an upstream crate supplies a license reference rather than the full grant, the
full canonical text is supplied alongside its original attribution. Dual-license
choices remain stated. Exact Git dependency notices are tied to their lock commit.
The metadata distinguishes canonical grants from exact source notices; it does
not claim a canonical grant identifies a binary's source revision. In particular,
the upstream POM's ring declaration has no matching Cargo.lock package, which is
explicitly recorded rather than inventing a linked binary version.

`sources.json` records source URLs, retained source paths, hashes, archive members
and input metadata for the copied notices. `metadata/` and `texts/` are part of
BashKitten's tracked corresponding source archive. Native-source correspondence
is separately enforced by the Android native source inventory and collector.
These are packaging supplements; pristine donor source is unchanged.

To update dependencies, retain the exact resolved POM/license metadata and matching
source JARs, review every added or changed declaration, update the pinned full texts
and hashes, and run `MavenNotices` against the newly generated dependencies and raw
OSS-license metadata. Verify the generated `licenses.json` and the About page's
embedded inventory agree and contain no unresolved URL-only or error responses.
