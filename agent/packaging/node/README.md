# Private native Node components

`build.py` assembles native upstream Node 24 LTS distributions. It does not fork
Node, substitute a JavaScript runtime, or depend on a globally installed Node/npm.
The executable at `node/bin/node` remains an ELF, so `process.execPath` and child
processes use the bundled runtime. `node/bin/npm` and `npx` explicitly launch it.
Matching upstream headers and `config.gypi` support native addon builds.

```sh
BASHKITTEN_NODE_CACHE=/path/to/persistent/cache python3 agent/packaging/node/build.py \
  --platform linux --architecture amd64 --output /path/to/artifacts
```

Linux accepts `amd64` and `arm64`; Termux accepts `x86_64` and `aarch64`. Python
3.12+, `dpkg-deb`, and `patchelf` are required. Outputs are
`node-runtime-PLATFORM-ARCH.tar.gz`, `node-source-PLATFORM-ARCH.tar.gz`, individual
SHA256 sidecars and `SHA256SUMS`. Downloads are content addressed and verified
against the checked-in lock. The source artifact preserves the builder, lock,
complete npm JavaScript distribution and notices, complete Node source,
Termux recipes and patches, and dependency source archives. The permissively
licensed libc++ runtime is taken from the original NDK r30 distribution. Its
original library, complete upstream NOTICE, LLVM notice and exact extraction
provenance are retained. Unrelated NDK host executables are not redistributed;
this input does not claim to contain LLVM's entire source repository.

## Pins and provenance

Reviewed 8 October 2026. Linux uses Node 24.21.0 / npm 11.19.0 from nodejs.org
with the published `SHASUMS256.txt`. Termux currently publishes Node 24.18.0-1 /
npm 11.20.0; its native Android patches and dependency builds are retained from
`termux/termux-packages` commit
`9f94db4fcd0a9029079b27ffd253e5d80c4caaa8`. The locked package indexes were checked
against Termux's signed InRelease, verified using the upstream automatic-build
key fingerprint `CC72CF8BA7DBFA0182877D045A897D96E57CF20C`. Upstream package,
source and recipe URLs, versions, index hashes and SHA256 hashes are in
`lock.json`. A newer official Linux patch version is not represented as a
Termux build before Termux publishes it.

The Android adaptation only selects Node's recursive ELF dependency closure
and sets each object's relative RUNPATH with 16 KiB alignment. The Node ELF
uses `$ORIGIN/../lib`; private libraries use `$ORIGIN`. Android's libc, libm,
libdl, liblog and libandroid remain OS libraries. No global `LD_LIBRARY_PATH`
is needed. Package launchers set `OPENSSL_CONF` to `node/etc/openssl.cnf`, an
explicit default-provider configuration, so another Termux OpenSSL installation
does not select this runtime's configuration. npm wrappers set it themselves.
Termux wrappers also select upstream termux-exec's
`TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE=disable` so execution uses the actual
Node ELF rather than making Android's dynamic linker the process executable.
If that mode was not already selected, wrappers re-execute `/system/bin/sh`
before any external command, because termux-exec caches its mode per process.
This is for the supported GitHub Termux target-SDK-28 environment; Android app
variants that prohibit executing their private binaries must fail explicitly.
Certificate verification remains enabled; Termux's CA and resolver data remain
declared package dependencies.

## Licenses

BashKitten's assembly code is AGPL-3.0-only. Node's complete upstream LICENSE,
npm's license, each actually bundled npm dependency's license/notice, and native
library notices are emitted in `node/licenses.json` and individual text files.
The source/distribution archives preserve the original notices too. npm package
versions and authored attributions are retained. Four npm packages omit a full
license file from the published distribution; checked-in supplemental texts are
pinned by URL and SHA256 in the lock. They include the upstream Sigstore LICENSE,
SPDX's standard CC0/CC-BY/ISC texts, and the SPDX exceptions author's attribution.
Supplemental standard text is identified as such rather than inventing a
copyright statement. A missing notice for any new vendored package fails the
build and requires an explicit reviewed lock update.

`licenses/Termux-packages-LICENSE.md` is the exact pinned repository policy:
package recipes/patches have their respective package licenses; general build
infrastructure is Apache-2.0. The complete Apache-2.0 text accompanies it.
`manifest.json` records native and npm dependency identities, input provenance
and remaining OS package dependencies for BashKitten's package and About page.

## Verification

The builder checks input hashes, ELF architecture, npm identity and the complete
Android shared-library closure. Packaging separately validates ELF segments and
16 KiB alignment. On this workstation, Linux amd64 Node/npm execute natively;
Termux x86_64 Node/npm execute under `run-as com.termux` in stock Android 17
Cuttlefish, with `process.execPath` pointing at the private native ELF. arm64
artifacts receive structural checks; physical ARM devices still require native
acceptance testing.
