# Android Maven native corresponding source

The existing `../android-sources.json` inventory pins these unmodified inputs.
They supplement Maven source JARs, which do not contain the native Rust source.
They do not replace Gecko's separately pinned desktop Application Services tree.

* `org.mozilla.appservices:full-megazord:153.0` corresponds to the complete
  Application Services `v153.0` source at
  `d05bd0f98d77e4c0ca2a11e5bae4f7299212c44b`, including the workspace manifest,
  Cargo lock, Rust toolchain declaration, Gradle/CI build files and full notices.
  Its native libraries are pinned by ABI to the published Maven AAR bytes.
* `org.mozilla.telemetry:glean:67.3.2` corresponds to complete Glean `v67.3.2`
  source at `24c647f24faedfe6839c99d18e58df0e288132a8`. Its Maven AAR supplies
  Kotlin bindings, not a separate native shared library. Gecko retains its
  Glean Rust source separately; this archive also preserves the release's root
  manifests, lock and Android build metadata.
* Both complete Cargo locks are covered: 617 registry package versions and four
  commit-pinned Git sources (including the AppServices-specific Glean build and
  symbol helpers). This deliberately preserves target-specific and build/test
  dependencies as well as the Android runtime graph. It does not assert that all
  617 packages are linked into the APK.
* The NSS 3.125 / NSPR 4.39 release archive is the exact SHA-256 input selected by
  Application Services `libs/build-all.sh`. That script retains upstream's NSS
  and NSPR build patches. The release archive records both Mercurial revisions.

The inventory's `retainedPath` reuses an identical archive already tracked in
this repository. Otherwise `file` is relative to `agent/vendor/native`.
Registry archive checksums must equal the original Cargo lock checksums. Git
snapshots use the original lock's exact commits; no dependency is upgraded.
License supplements preserve exact upstream release text where available.
Where a published crate omits the grant text, the inventory labels the supplied
standard terms and preserves the crate's own author metadata without inventing
a copyright holder or year. Original archives are never rewritten.

`agent/packaging/android_native_sources.py` verifies these retained inputs, both
Cargo dependency closures, full license file presence and the browser's Maven
version selections. Both the release source collector and Android artifact
collector call it. The latter also checks the resolved Maven inventory and the
actual APK's native library bytes. Missing or mismatched inputs fail collection;
collection never downloads sources.

Both Android dependency source outputs include `android-native-sources/` with
the inventory and original archives/license supplements at their repository
paths. The complete BashKitten source archive also includes all tracked inputs.
For upstream rebuilding, extract the source archives, use the retained Cargo
packages with Cargo's source replacement/vendor mechanism, and put the retained
NSS archive beside `libs/build-all.sh`. Follow the retained upstream Android
build and toolchain instructions. BashKitten continues to consume the exact
Maven releases; source retention does not claim a local native rebuild or
bit-for-bit toolchain reproduction.
