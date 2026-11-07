# Native Arch release packages

The normal Taskarian publisher converts its already downloaded and verified
Linux `amd64`/`arm64` Debian payloads into `x86_64`/`aarch64` pacman packages.
It uploads both formats in the same new release. It does not rebuild the
application or components, download them again, or change an older release.

```sh
python3 agent/packaging/arch/release.py \
  --input-directory /path/to/verified-release \
  --release-tag v153.6.5 \
  --output /path/to/arch-output
```

Python 3.11+, `zstd`, and either Python's built-in zstd support or
`python3-zstandard` are required. Output comprises two `.pkg.tar.zst` files,
per-package provenance, and `SHA256SUMS.arch.txt`. The publisher adds these to
its complete `SHA256SUMS`; the existing Debian `release.json` entries and source
indexes are preserved. A packaging-only change at the same application version
requires increasing `--pkgrel`. Different existing package bytes are rejected.

The source `SHA256SUMS`, `release.json`, DEB size/hash, Linux platform and actual
Debian control identity must agree. Only Linux controls `amd64` and `arm64` are
accepted; native Termux `aarch64` and `x86_64` packages are rejected. Package
version comes from the actual DEB, never from its filename or release tag.

`rules.json` explicitly maps the reviewed Debian dependencies to native Arch
packages. Unknown dependencies or constraints stop assembly for review.
`python>=3.12`/`python<3.15` preserve the shipped search wheels' supported Python
range. Native GStreamer packages supply the same PipeWire and PulseAudio
functions; `shadow` provides `newuidmap`/`newgidmap`. The existing private
Podman/crun/conmon/network/storage helpers remain bundled, with their own
Taskarian lifetime and private socket. No system Podman daemon is installed or
activated by this packaging.

Debian maintainer scripts are never executed by the converter. The small
native pacman `taskarian.install` adapter preserves runtime initialization,
installation stamps, the exact legacy Pi alias retirement, optional AppArmor
loading, administrator policy choices and retained runtime/user data. Source
scripts must exactly match `reviewed-scripts` after substituting the runtime
identity derived from the shipped build stamp and runtime default. Changes to
script behavior stop assembly. Pacman's `backup` protects the AppArmor profile;
Arch's existing desktop/icon/font hooks handle their own caches.

All regular payload bytes, modes, symlinks, offline full licenses and notices
are retained. Ownership is normalized to root and timestamps use
`SOURCE_DATE_EPOCH` (default 0). No payload is extracted onto the packaging host,
no Debian library-path mapping is guessed, and special/setuid files are
rejected. Provenance identifies the original installer, release, source commit,
reviewed scripts, native adapter and packaging source checksums. Full component
sources retain their original permanent release links.

The initial archive reader/converter was adapted from
[SimpleHF](https://github.com/openresearchtools/simplehf/tree/0acb82b8264a5ccbd9338ee5dcf901944df6665b/packaging/arch)
(MIT; full text in `LICENSE.simplehf`). Taskarian additions are AGPL-3.0-only.
Packaging checks and fixtures stay outside this repository, as required by
`AGENTS.md`; successful archive checks do not establish installed UI acceptance.
