# Module evidence — 28 October 2026

This is implementation evidence, not feature or installed-platform acceptance.
Requirements remain in `../docs/files-office-bibliography-plan.md`.

## Observed

- Exact pristine Quantum and selected upstream WOPI imports preserved with full
  licenses/checksums; recursive Git blob inventory matched the selected stable
  source, including upstream ignored source/fixtures.
- Native Quantum frontend and Go executable compiled independently. The three
  original named native patches apply with zero fuzz; the licensed dependency
  patch and isolated FFmpeg subset are checked during preparation too.
- Native proxy accounts, explicit source scope, prefixed ordinary HTML and source
  listing returned 200; private direct reads returned 403. Native YAML loader
  requires a `.yaml` filename even when the content is valid JSON/YAML; corrected.
- Runtime-owner integration exercised real Caddy HTTPS and native Files. Two
  launches had distinct grants and one Quantum process; admin/private traversal
  was denied; quit stopped the owned process. External evidence:
  `BashkittenBuild/verification/apps-native-gateway-20261028/native-gateway-evidence.json`.
- Standalone add-on rebuilt and Go vet passed, including derived native Save As
  session registration and distinct random token identities.
- Actual stock Collabora native RSA proof key generation enabled discovery proofs.
  Independent WebSocket/script edits and signed WOPI LOCK/PutFile completed for
  DOCX, ODT, XLSX, ODS, PPTX and ODP. The actual project files had durable native
  content and updated versions. Native browser-settings downloads were observed
  unsigned; the restricted settings GET exception is documented in source.
- Encoded native route checks denied administrative paths (403), rejected encoded
  separators (400), and served encoded `/api/raw` HTML with an opaque sandbox and
  disabled forms. Trusted SPA loading and ordinary lists remained successful.
- Actual native DOCX Save As produced a distinct registered document identity;
  its copied citation unlink operation preserved the original citation and saved
  a copy without it. A streamed Save As deadlock was found and corrected.
- Focused storage checks covered complete atomic writes, bounded retention,
  private immutable snapshot reads, download denial, interrupted save preserving
  original bytes, and generation invalidation. The isolated storage restore
  coordinator was synthetic; this is **not** native broker restore acceptance.
- Real native DOCX history restore received the exact broker
  `versionrestore: prerestore_ack`, restored generation 2, rejected the old
  generation, and reopened with the retained baseline text. This used a fresh
  authenticated native coordinator participant, not a synthetic acknowledgement.
- New native document placeholders retain no empty version; the first actual
  signed native save immediately retains one full valid version (observed).
- ARM64 full Files cross-compilation and Android ELF/library-closure checks
  succeeded using pinned NDK r30 and the retained Termux framework. Both ARM64 and x86_64
  full native builds passed. Actual x86_64 Termux app execution (UID 10123,
  `untrusted_app_27`, RunCommandService) passed FFmpeg/ffprobe, native Files
  page/list, private denial, PDF and video JPEG previews, SQLite, and the add-on
  private Unix health endpoint. Owned children exited afterward. Evidence:
  `BashkittenBuild/verification/files-termux-20261028/native-termux-evidence.json`.
  Reopening the same native database exposed a duplicate denyAll API failure;
  native GET-before-create reconciliation corrected it and the restart passed.
- Actual revoked-view close released only its proof-verified matching native lock;
  a fresh grant reacquired the lock and opened editable with saved content intact.
  The runtime owner's real archive/unarchive/reopen integration also passed.
- Actual native token reset preserved the same view ID; its next signed PutFile
  used the new token and produced a durable save. Expiry scheduling and recovery
  after prolonged disconnect still need product exercises.
- The native light patch passed released TypeScript compilation after correcting
  its global type access. The older global.js linter rejected optional chaining;
  changed to its supported guard syntax. Full native build/UI evidence is pending.
- Offline dependency preparation verified 92 Go and 460 npm archives; native
  source includes MuPDF, FFmpeg, dav1d, NASM, esbuild and Rollup. The controlled Ubuntu 24.04
  build compiled native MuPDF, dav1d, zlib, FFmpeg, Quantum frontend/Go and the
  add-on. Actual ELF/dpkg analysis reports only `libc6 (>= 2.38)` and maximum
  `GLIBC_2.38`. Linux amd64 and both Termux architectures were sealed successfully
  with retained Go 1.27.2 and dav1d 1.5.4, clean source revision
  `12923eaccbfc299c70892166aae0b9aa2cff4bd6`, and 599 checked files per artifact.
  Exact artifact hashes/paths are recorded outside the repository in
  `BashkittenBuild/components/files/artifacts/sealed-receipts-20261028.json`.
- The runtime owner's actual Caddy/native test changed the validated forwarded
  Host to another HTTPS port. The wrapper form used that exact origin; native
  editor POST, public WebSocket, history, References bridge and token renewal
  passed. The human view remained distinct from Pi. This tests the gateway
  mapping contract, not installed Chisel/browser certificate acceptance.
- The actual native export pipeline returned a scoped Files URL, resolved it to
  a fresh human grant, transferred valid PDF bytes through mapped HTTPS, and
  rejected its second use with 404. The explicit browser copy action returned
  the mapped saved-copy URL; native inspection found zero managed citations in
  the copy and one in the unchanged master. Evidence:
  `BashkittenBuild/verification/apps-native-gateway-20261028/office-copy-export-evidence.json`.
  A restricted remote-account export test was unavailable in that fixture.
- Normal package assembly rejected the sealed Files artifacts because 73
  dependency records had no full notice text. Successful native compilation and
  clean manifests did not establish that legal-content requirement. The producer
  now checks all notice records before compilation and fails with the exact
  unresolved names; retained README notices, same-version parent notices and
  original pinned supplementary licenses are being reconciled. Those earlier
  artifacts remain diagnostic build outputs and cannot enter normal packages.
  The 70 npm gaps now resolve to checksum-bound original text or explicitly
  labelled exact-package SPDX declarations plus pinned canonical text. The audit
  rejected the three original `gtsteffaniak/go-cache`, `go-logger` and
  `go-ffmpeg` versions: those pins contain no usable license declaration/text.
  No license was inferred for them.
- The licensed native replacements now build on Linux amd64 and both Termux
  architectures: patrickmn/go-cache 2.1.0, Logrus 1.10.2 and go-ffmpeg 1.0.0.
  Actual prepared/linked inventories prove those versions and exclude the old
  cache/logger modules. All 562 Linux / 564 Termux notice records have text.
  A fresh empty Go cache resolved the actual 79-module Linux executable closure
  from a file-only proxy containing only selected source inputs. Obsolete
  unlicensed archives were removed from the current source bundle; pristine
  imports remain recoverable in Git history.
- The new Linux binary passed native page/list, private denial, PDF/video
  thumbnails, eight concurrent previews, byte-range streaming and SQLite checks.
  The new x86_64 binary passed the actual Termux app fixture under UID 10123 and
  `untrusted_app_27`. Its fixture first mistook a stale socket inode for readiness;
  waiting for an actual connection corrected that diagnostic race.
- Native media checks exposed a file-metadata capability gap: upstream requires
  TCP for generic `ProbeStream`, including local files. An isolated patch selects
  the existing file-only ffprobe gate for `StreamFile`. Actual queued cancellation,
  eight previews after cancellation, embedded subtitle extraction and local
  metadata then passed. Network protocol support remains disabled. Evidence is
  under `BashkittenBuild/verification/files-licensed-20261028/`.
  These are development validations; final sealing correctly refused dirty
  source. A clean committed rebuild and normal package collector acceptance
  remain required, including the final capability patch.

## Remaining coverage

Real native history restore with simultaneous human/Pi views; snapshot-native viewing;
full References ZIP/dialogs in all editors; paired live user/agent editing and
revocation under ongoing work; final native artifact/traffic review; long healthy
Tor transfers and stalls; normal-tab remote mapping and TLS trust; runtime light
settings on desktop/phone; ARM64 device execution and installed Linux/Android flows.

A one-frame synthetic video revealed an upstream thumbnail seek past its only
frame; the normal 20-frame sample passed. That edge case remains a tracked native
media follow-up, not a general video-preview pass for every input. ADB fixture
copy permissions and a fixture syntax error were corrected before the successful
real-app run; neither required an application privilege workaround.

The build's selected FFmpeg native codec profile must be checked against actual
Quantum thumbnail/metadata/streaming operations. Optional external hardware and
filter libraries are not silently inherited from the build host. Native Termux
compatibility is not claimed from Linux compilation. Expiry/long-session save
behavior and crash recovery receipts still require end-to-end exercises.
