# Product packaging

All compilation runs in GitHub Actions. Dispatch `Complete BashKitten candidates`
on `main` to build the Android APK and complete Linux amd64, Linux arm64 and
Termux aarch64 packages. The main workflow builds authentication/search components,
Termux and source bundles. It dispatches the exact product commit to these builders:

- `openresearchtools/bashkitten-build-arm64`: complete Linux ARM64 `.deb`.
- `openresearchtools/bashkitten-build-amd64`: complete Linux AMD64 `.deb`.
- `openresearchtools/bashkitten-build-android`: signed Android APK.

Each builder has its own compiler cache and uploads its installable candidate to
its Actions run. Those artifacts can be downloaded manually immediately. The
main workflow collects each target as soon as its upload appears; it does not
wait for the other builders. Complete release assembly still requires all four
binaries. Neither the builders nor the candidate workflow publish releases or APT.

`BUILD_REPOS_TOKEN` exists only as an encrypted Actions secret in the product
repository. Its fine-grained scope is Actions read/write on those three builders.
Builders use their own job token to read the public product's component artifacts;
only the Android builder also needs the four existing Android signing secrets.
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
Mozilla bootstrap directory. Compiler statistics are saved immediately after
Gecko compilation and remain downloadable from each run.

`build.py` accepts `linux|termux`, `--architecture`, `--auth-archive`,
`--search-archive` and `--output`; Linux also requires `--browser-dir`.
Each component requires its `SHA256SUMS` and target metadata. The Firefox-aligned
product version comes from `browser/bashkitten/config/version.txt`; internal npm
metadata uses its three-component SemVer equivalent. Native architecture and
Termux 16 KB ELF alignment are checked before creating the package.

`release.py` collects exactly one signed `com.bashkitten` APK and three complete
native packages plus corresponding sources. A release must match the exact
successful candidate run. Runtime/device validation happens outside the repository
before publishing or APT promotion. Logs, probes and test profiles are not shipped.

The Android workflow accepts native-auth and native-search run IDs when dispatched
alone. Its full Gecko build starts immediately; final Gradle assembly waits for
the actual Termux component notices. Temporary server payloads supply license
texts only and never enter the APK. Droid credentials stay in GitHub secrets and
an external temporary file removed after signing.
