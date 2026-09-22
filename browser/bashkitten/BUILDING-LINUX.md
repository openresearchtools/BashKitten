# Linux builds

The repository's GitHub Actions workflow builds amd64 and arm64 browser
components from `browser/`, using Mozilla's pinned toolchains and the existing
`sccache`/optional Rust warm-up flow. `scripts/build-linux-external.sh` keeps
objects and caches outside source.

Final packaging combines the matching browser archive with Agent, Pi, DDGS and
authentication artifacts using `agent/packaging/build.py`. It produces one full
Debian package per architecture. Component source, configuration and toolchain
keys control reuse; a changed Agent payload does not require rebuilding Gecko.
