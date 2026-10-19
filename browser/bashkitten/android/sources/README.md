# Pinned Android dependency sources

`sources.json` is the source inventory used by Fenix's
`stageBashKittenDependencySources` task. `archives/` retains the exact matching
Maven source JARs for 263 runtime dependency coordinates. Their SHA-256 hashes
match the source output of the `bd393bd7ec59eebd3f540072dc9511917520de9c`
Android candidate. These original archives have not been repacked or modified.
The Gradle source query resolved the exact versioned Maven coordinates; a source
JAR does not establish an additional upstream Git commit when none is recorded.

`metadata/` retains the actual descriptors for four BOMs, the Kotlin common
redirect, and Guava's empty conflict-avoidance marker. The inventory identifies
these as metadata-only, not implementation sources. The build checks their
actual selected runtime artifact set and checksums; an unexpected binary cannot
be accepted as metadata. Each retained input is copied into the matching source
archive with its component and checksum.

All copied source is governed by its original notices. Full offline legal text
and original upstream attribution are retained by `../notices/maven/`; that
legal inventory is not a substitute source inventory. Do not replace either
with generated workstation paths or post-download checksums.

When dependencies change, collect the exact source and descriptor bytes through
the existing pinned Maven graph, review the new inputs and notices, and update
this one inventory in a source commit. Builds consume its committed pins and
fail for an unknown component, missing input or mismatched checksum. Thirteen
retained runtime SDKs still lack source and keep release preparation blocked;
see `docs/android-dependency-source-status.md` in the repository root.
