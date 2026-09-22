# Product packaging

All compilation runs in GitHub Actions. Dispatch `Complete BashKitten candidates`
on the implementation branch to build the Android APK and complete Linux amd64,
Linux arm64 and Termux aarch64 packages. The workflow builds independent native
authentication, search and browser components, then verifies their hashes and
assembles matching payloads. It does not publish a release or update APT.

The Linux browser workflow retains the external build directories, Mozilla
bootstrap toolchains, compiler cache and optional gkrust warm-up from WildBuzzard.
Browser archives are cached by their actual input digest; Agent-only changes
reassemble the package without rebuilding unchanged Gecko. Cached archives retain
their original source commit. Native arm64 builds use an arm64 runner.

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
