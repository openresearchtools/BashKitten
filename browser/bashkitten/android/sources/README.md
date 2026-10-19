# Pinned Android dependency sources

`sources.json` is the source inventory used by Fenix's
`stageBashKittenDependencySources` task. `archives/` retains the exact matching
Maven source JARs for 261 currently required runtime dependency coordinates. Their SHA-256 hashes
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
fail for an unknown component, missing input or mismatched checksum. Retained
runtime SDKs still lack source and keep release preparation blocked;
see `docs/android-dependency-source-status.md` in the repository root.

`firebase-annotations:17.0.0` is retained as a source snapshot archive instead of
an unavailable Maven source JAR. The official module's version declaration is
pinned to `bcaf4c38b9dcdafcf9ded322d689a0aa18214f7d`, with each original file and
its Apache-2.0 license preserved. Compiling its six Java annotations with
`javac -source 8 -target 8` and the resolved `javax.inject:javax.inject:1` reproduced
every published class byte. The one inventory records the upstream revision,
source-file hashes, binary-JAR hash and six matching class hashes. This is an
explicit source correspondence check; the repository does not advertise a
release tag for this module. Staging checks the selected binary hash before
accepting the pinned source snapshot.
