# Candidate and release packages

Build with `python3 packaging/build.py linux` or
`python3 packaging/build.py termux`. The Termux target requires npm 10+ and
selects upstream Android/Bionic dependencies explicitly. Native Linux ARM64 and
AMD64 Actions jobs build and test their own packages; do not relabel binaries.
After npm installation, the package builder and Pi updater omit optional packages
whose published OS/CPU constraints exclude the target. npm otherwise retains
foreign binaries below Pi's nested shrinkwrap. The lock and all selected package
contents stay unchanged; Pi itself is not patched. Old active runtimes remain
intact until normal replacement and garbage collection.

After the device and host checks pass, collect one signed Android candidate
(including its `manifest.txt` and `sha256sums`), the four Linux packages from one
successful matrix run, and the tested Termux package into a clean directory.
Do not include instrumentation/unsigned APKs or earlier candidate builds.

```sh
python3 packaging/release.py dist/release-inputs dist/release-output \
  --tag candidate-YYYYMMDD --android-run ANDROID_RUN --linux-run LINUX_RUN \
  --java /path/to/java --apksigner-jar /path/to/apksigner.jar
```

This assembles local artifacts only. It checks successful `main` builds,
unchanged build inputs, package identities/source stamps, APK certificate and
hashes, and collects exact application/Pi/npm source and notices. It writes
`release.json` and `SHA256SUMS`. The source collector verifies its cached
upstream archives against the exact integrity locks.

Publish complete binary/source assets as a GitHub prerelease for actual store
installation checks. Prereleases are excluded by the existing APT publisher.
Promote tested immutable assets only after the implementation plan's release
gates pass; then select their hash-pinned manifests in the Termux suite catalog
and dispatch the existing APT publisher. Source, keys and candidate test results
have separate ownership: signing backups and personal runtime data stay outside
Git and release assets.
