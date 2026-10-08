# Product packaging

Release compilation runs in GitHub Actions; the 8 October local setup also uses
an external data-drive workspace and cached Podman builders. Dispatch `Complete BashKitten candidates`
on `main` to build ARM64 and x86_64 Android APKs, Linux amd64/arm64 packages,
and native Termux aarch64/x86_64 packages. The main workflow builds authentication/search/private-Node components,
Termux and source bundles. It dispatches the exact product commit to these builders:

- `openresearchtools/bashkitten-build-arm64`: complete Linux ARM64 `.deb`.
- `openresearchtools/bashkitten-build-amd64`: complete Linux AMD64 `.deb`.
- `openresearchtools/bashkitten-build-android`: signed ARM64 Android APK.
- `openresearchtools/bashkitten-build-android-x86_64`: signed x86_64 Android APK.

Each builder has its own compiler cache and uploads its installable candidate to
its Actions run. Those artifacts can be downloaded manually immediately. The
main workflow collects each target as soon as its upload appears; it does not
wait for the other builders. Complete release assembly still requires all six
binaries. Neither the builders nor the candidate workflow publish releases or APT.

`BUILD_REPOS_TOKEN` exists only as an encrypted Actions secret in the product
repository. Its fine-grained scope is Actions read/write on those four builders.
Builders use their own job token to read the public product's component artifacts;
both Android builders also need the four existing Android signing secrets.
Never put credential values in source or workflow files.

The builder workflow sources are `.github/builders/linux.yml` and `android.yml`.
Deploy each to `.github/workflows/build.yml` on its builder's `main` when changing
the build recipe. The builder repositories contain workflow configuration only;
all application source remains here and is checked out by exact commit.

The Linux browser workflow retains the external build directories, Mozilla
bootstrap toolchains, compiler cache and optional gkrust warm-up from WildBuzzard.
Completed browser archives/APKs are reused as Actions artifacts when their build
inputs match, leaving the cache quota for compiler objects. Agent-only changes
reassemble the Linux package without rebuilding unchanged Gecko. Cached binaries
retain their actual producing commit in provenance. Native arm64 builds use an
arm64 runner. Initial builds in the new repositories start with empty caches.
Android caches Gradle dependency downloads without storing the multi-gigabyte
Mozilla bootstrap directory. Gradle task outputs use a separate Actions artifact
with the repository's normal retention, restored from a successful builder run.
They do not consume GitHub's
compiler-cache quota. Gradle validates each task's inputs before reuse; changed
application inputs can still require R8 to run. Pass caching/worker options using
`GRADLE_FLAGS`, since `mach` replaces `GRADLE_OPTS`. Compiler statistics are saved
immediately after Gecko compilation; those and the Gradle timing report remain
downloadable from each run.

`build.py` accepts `linux|termux`, `--architecture`, `--auth-archive`,
`--search-archive`, `--node-archive` and `--output`; Linux also requires `--browser-dir`.
Each component requires its `SHA256SUMS` and target metadata. The Firefox-aligned
product version comes from `browser/bashkitten/config/version.txt`; internal npm
metadata uses its three-component SemVer equivalent. Native architecture and
Termux 16 KB ELF alignment are checked before creating the package.

`release.py` collects two signed `com.bashkitten` APKs and four complete
native packages plus corresponding sources. A release must match the exact
successful candidate run. Runtime/device validation happens outside the repository. Prereleases are published
for that testing; a completed build does not certify device acceptance. Logs, probes and test profiles are not shipped.

The publisher's **prerelease** checkbox defaults on for now. On publishes to
nightly APT; off publishes a regular release to stable APT. The stable catalogue
excludes prereleases, and the nightly catalogue includes only prereleases. Install the
platform's stable keyring first and then its `openresearchtools-nightly` or
`openresearchtools-termux-nightly` package to opt in. Both sources remain enabled
with equal priority, so a newer stable package can replace a nightly. Removing
the nightly setup package disables that source and leaves stable enabled.

Every published version is a testing release. `release.py` includes the
README's warning SVG and an explicit production warning in `release-notes.md`.
Run **Prepare next release candidate** on main to select a product version greater
than every published regular release and prerelease. It preserves a newer,
unpublished committed version; otherwise it increments the maintenance point on
the same Firefox major/minor line using the existing Firefox version helper.
It synchronizes the Agent npm version, commits changes before dispatching the
complete candidate build, and does not publish. The manual **Publish testing
release** workflow takes the successful complete-candidate run, the prerelease
choice and those exact notes. Publication rejects a duplicate or older version
across both channels. Any manual publication must also use the notes file
with `gh release create --notes-file`; never replace it with autogenerated notes.

The Android workflow accepts native-auth, native-search and private-Node run IDs when dispatched
alone. Its full Gecko build starts immediately; final Gradle assembly waits for
the actual Termux component notices. Temporary server payloads supply license
texts only and never enter the APK. Droid credentials stay in GitHub secrets and
an external temporary file removed after signing.

Both channels use the exact committed product version for `.deb` versions and
`v<product>` tags, for example prerelease `153.4.1`, prerelease `153.4.2`, then
regular release `153.4.3`. There is no nightly version suffix or separate stable
sequence: with both sources enabled, APT takes the higher version from either.
The channel is GitHub's prerelease flag; candidate binaries are not relabeled
or promoted by changing their compiled version at publication. The Android
version code is `2020000000 + floor((commitEpoch - 1767225600) / 60) * 8 + abiBits`,
where ARM64 uses 2 and x86_64 uses 6. This advances beyond the previous Fennec
version codes while preserving deterministic rebuilds. Publish distinct APK
updates from different source minutes; reusing an identical cached APK keeps its
original code and does not require a browser update.


Private Node components are built by `node-native.yml` for Linux amd64/arm64 and
native Termux aarch64/x86_64. `node/build.py` consumes hash-pinned official Node
LTS or Termux binaries and publishes `node-runtime-<platform>-<arch>.tar.gz`,
`node-source-<platform>-<arch>.tar.gz` and SHA256SUMS. Its download cache defaults
to `~/.cache/bashkitten-node` and can be moved with `BASHKITTEN_NODE_CACHE`.

Termux launchers use upstream termux-exec's
`TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE=disable` for BashKitten and its children.
This preserves the actual Node ELF in `process.execPath`, including under
`RUN_COMMAND` and terminal environments with `LD_PRELOAD`. The supported
GitHub/F-Droid Termux app targets SDK 28 and permits direct native execution;
a variant whose Android policy forbids it is unsupported. The executable check
does not silently substitute Android's linker or a system Node runtime.
The payload contains the actual Node ELF, npm/npx wrappers bound to that ELF,
private npm sources and native libraries, target/version/source metadata and
full license texts. `build.py` rejects mismatched targets and missing notices;
Node/npm are no longer external package dependencies. Runtime libraries that
remain external are declared by the component manifest.

The four remote builders require a `node_run` input along with `auth_run` and
`search_run`. Deploy the updated builder workflows before dispatching candidates.
Android embeds the matching companion Node notices in its offline inventory.
`sources.py --node-sources DIR --cache DIR` retains all four verified Node source
archives alongside product/npm source. Source caches and build outputs stay
outside the checkout. Release assembly rejects packages without Node provenance
or missing Node source artifacts.
