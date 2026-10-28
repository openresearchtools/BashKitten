# Native Office component builds

The released Collabora Online `cp-26.04.5-2` source includes its matching engine.
`office/upstream/online/source.json` records the immutable commit and Git trees;
`source_graph.py` verifies the complete pristine tree, the native engine's
selected external archives and the released browser shrinkpack integrity.
Named patches are applied only to an external build directory. Existing objects
and compiler caches remain reusable. Builds do not use a downloaded CODE image.

Run the Linux recipe on the target architecture in Ubuntu 24.04, after installing
the prerequisites in `prepare-runner.sh` and Node 24.13.0:

```sh
CCACHE_DIR=/outside/source/ccache python3 agent/packaging/office/build.py \
  --work /outside/source/office-work --cache /outside/source/office-tarballs \
  --output /outside/source/office-output --jobs 2
```

The `prepare`, `engine`, `online` and `package` phases are independently runnable.
The engine uses its released `CPLinux-LOKit` profile. The recipe invokes native
gbuild, the Online browser/server build, both upstream SBOM owners and the native
installation rules. Build-only export validators are excluded; document import,
editing, export, scripting and rendering features remain selected.

Packaging records the exact source, named patch hashes, toolchain versions,
complete runtime file hashes and OS dependencies derived from actual ELF files.
It includes the engine and browser legal texts, including a verified supplemental
license where an upstream npm package omitted its license file. Local builds
with uncommitted component inputs are marked as development artifacts; ordinary
release assembly rejects them. The References Office plugin is packaged by the
main application packager as its separately replaceable native extension ZIP.

`termux.py` uses the same source graph and native server/kit entry points with the
existing pinned NDK and retained libc++ sources. Its additional source patches
and port notes live under `office/patches/termux` and `office/packaging/termux`.
The Android `MOBILEAPP` target is not the collaborative server. A configured or
compiled target does not establish installed Termux acceptance.

The canonical daughter workflow is `.github/builders/office.yml`, mirrored in
`openresearchtools/office-builds`. It accepts an exact main-repository commit and
uploads one ordinary Actions artifact per Linux or Termux target. It uses
ordinary Actions caches, without registry images, registry cache or separate
product releases. `remote-office.py` checks the producer workflow, requested
commit, target, archive checksums and complete file inventory before collection.
The normal BashKitten package and corresponding-source flows retain ownership
of product delivery. Native compile and package success remain separate from
installed editing, collaboration and citation acceptance.
