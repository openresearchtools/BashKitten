# Module evidence — 28 October 2026

This is implementation evidence, not feature or installed-platform acceptance.
Requirements remain in `../docs/files-office-bibliography-plan.md`.

## Observed

- Exact pristine Quantum and selected upstream WOPI imports preserved with full
  licenses/checksums; recursive Git blob inventory matched the selected stable
  source, including upstream ignored source/fixtures.
- Native Quantum frontend and Go executable compiled independently. The three
  named native patches apply with zero fuzz.
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
- The native light patch passed released TypeScript compilation after correcting
  its global type access. The older global.js linter rejected optional chaining;
  changed to its supported guard syntax. Full native build/UI evidence is pending.
- Offline dependency preparation verified 92 Go and 460 npm archives; native
  source includes MuPDF, FFmpeg, dav1d, NASM, esbuild and Rollup. The controlled Ubuntu 24.04
  build compiled native MuPDF, dav1d, zlib, FFmpeg, Quantum frontend/Go and the
  add-on. Actual ELF/dpkg analysis reports only `libc6 (>= 2.38)` and maximum
  `GLIBC_2.38`; packaging awaits the committed-source gate.

## Remaining coverage

Real native history restore with all human/Pi views; snapshot-native viewing;
full References ZIP/dialogs in all editors; paired live user/agent editing and
revocation under ongoing work; final native artifact/traffic review; long healthy
Tor transfers and stalls; normal-tab remote mapping and TLS trust; runtime light
settings on desktop/phone; native Termux build and installed Linux/Android flows.

The build's selected FFmpeg native codec profile must be checked against actual
Quantum thumbnail/metadata/streaming operations. Optional external hardware and
filter libraries are not silently inherited from the build host. Native Termux
compatibility is not claimed from Linux compilation. Expiry/long-session save
behavior and crash recovery receipts still require end-to-end exercises.
