# Retained authentication build inputs

These are original dependency archives for the existing authentication and
remote-service builds. They supplement the already tracked upstream trees; they
do not update their versions or replace the existing component locks.

* `go/sources.json` records the union of the component `go.sum` inventories,
  original module ZIP/mod/info files, Go `h1` sums, archive SHA-256 values and
  available proxy-provided Git origins. `go/proxy` is a local Go module proxy.
  Historical/test-only entries are retained too; their presence does not mean
  they are linked into a shipped executable. Missing proxy Git-origin metadata
  is left absent, rather than inferred from a moving branch; the exact source
  is identified by its module version and verified `go.sum` content hash.
  Include the Android binding/tooling module graph: gomobile resolves `all`
  and runs `go mod tidy`, including metadata for modules not linked into the client.
* `frontend/sources.json` covers every package in the existing Authelia web
  `pnpm-lock.yaml`, including build and optional platform dependencies. Original
  npm tarballs retain their locked integrity plus an independent SHA-256 hash.
* `go-toolchain/sources.json` pins the official Go 1.27.2 source release and
  peeled release commit used by the authentication build, including the standard
  library sources linked into the runtime and their full license texts.
* `termux/sources.json` retains the two exact Termux build-framework revisions
  selected by the authentication and search locks. These are build inputs,
  not a bundled alternate Termux application.

Manifest paths are relative to their manifest unless a field explicitly records
a repository lock path. `licenses` identifies paths inside the unchanged source
archive. Supplemental `licenseFiles` records identify original upstream full
grants omitted from published package archives, with their own source URL,
commit when available, checksum and explanation. A license-only supplement never
changes the package source pin. Build and release collectors must verify the
matching locks/checksums and retain the full texts for actual shipped components;
an SPDX label alone is not a substitute. Original package scripts are source
material, not instructions to execute during source collection.

These archives were materialized from the existing Go/npm release inputs on
11 October 2026. No development branch, local binary or unrecorded workstation
cache is a replacement for a missing retained source. Runtime source/notices
inventories remain based on what each target actually builds and ships.
