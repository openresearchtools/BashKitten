# Pinned Android dependency sources

`sources.json` is the source inventory used by Fenix's
`stageBashKittenDependencySources` task. `archives/` retains the exact matching
Maven source JARs for 246 currently required runtime dependency coordinates.
The initial corpus matches the source output of the
`bd393bd7ec59eebd3f540072dc9511917520de9c` Android candidate; subsequent
dependency changes are recorded in this inventory and Git history. These
original archives have not been repacked or modified.
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
fail for an unknown component, missing input or mismatched checksum. The active
inventory contains exactly the 252 resolved coordinates after removing website
push and the Google client SDKs. Removed sources and their attribution remain
recoverable in Git history; they are not copied into later source archives.
Staging rejects the removed SDK groups and stale inventory entries. Artifact
collection also checks the staged inventory against the current pins and rejects
defined Play Services, Play, Firebase or Install Referrer classes in the APK
before signing it. AndroidX, Material and other sourced libraries remain valid.

Removing the Firebase constraints lets Guava select its declared
`error_prone_annotations:2.15.0`. Its original Maven Central source JAR, POM and
Apache-2.0 notices are pinned at that exact selected version. This is a dependency
resolution change, not an independently selected SDK update.
