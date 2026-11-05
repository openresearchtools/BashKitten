# Browser build components

Root `.github/workflows/browser-linux.yml` builds reusable native browser archives
on Ubuntu 24.04 amd64 and arm64 runners. It preserves the external source/object
layout, Mozilla bootstrap toolchains, GHA compiler cache and optional gkrust
warm-up from WildBuzzard. The complete-product workflow assembles these archives
with the Agent, authentication and search payloads after verifying their hashes.

The source tree lives at `browser/` within the product repository. Run `mach`
there; generated files and build output stay in external runner directories.
`build-browser-artifact.sh` records the actual producing commit and source-input
digest. A cache hit retains that provenance; an Agent-only change can reuse the
unchanged browser component. Final packages and sources are collected by
`agent/packaging/release.py`, with publication after device validation.
