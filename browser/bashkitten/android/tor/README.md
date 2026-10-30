# Android Tor native build

The existing APK `TorService` loads Guardian Project's JNI API. Build that same
API against the official Tor release retained in `browser/third_party/tor`;
ordinary Tor Browser Android expert binaries are executable daemons without
these JNI exports and cannot be substituted.

`upstream/` preserves the required files byte for byte from Guardian Project
tor-android commit `0340ba1609cb73e663e202a316d083803e399db4`. `pins.json` records
their hashes, the original corresponding-source archive and the existing
dependency/NDK owners. `patches/0001-guardian-android-jni.patch` retains the
attributed runtime/build delta from Guardian's Tor fork, omitting unrelated CI,
funding and disabled tests. The patch applies only in the external build tree.
There are no BashKitten Tor protocol, authentication or routing modifications.

Build either required ABI using the existing NDK r30 and a JDK with JNI headers:

```sh
export BASHKITTEN_SOURCE_CACHE=/absolute/external/source-cache
python3 -B browser/bashkitten/android/tor/build.py --abi arm64-v8a \
  --ndk /absolute/android-ndk-r30 --jdk /absolute/jdk \
  --work /absolute/external/tor-work --output /absolute/external/tor-runtime
export BASHKITTEN_TOR_ANDROID_DIR=/absolute/external/tor-runtime
```

Repeat with `--abi x86_64`. Without `--ndk`, the builder prepares the existing
checksum-pinned NDK from the source cache. A verified warm cache supports
`BASHKITTEN_OFFLINE_SOURCES=1`. Use a fresh work directory after a failed build;
the previous directory and its `build.log` remain available for diagnosis.

Guardian's native Makefiles build static libevent, OpenSSL, zlib and zstd, then
the JNI library and its ELF cleaner. They retain `--enable-gpl`; complete Tor,
Equi-X/HashX, GPL and dependency notices are supplied offline. Original upstream
source archives are included by the normal corresponding-source collector.
No Guardian Gradle app, sample app, publisher or runtime service is added.

The completed output contains each ABI's `libtor.so`, input/binary/ELF manifest
and provenance ZIP. The normal `stageTor` owner checks current source inputs,
ABI, JNI exports, static dependency boundaries and 16 KB load alignment before
staging the library and its provenance into the APK. Ordinary Android builder
Actions cache this native output independently of Gecko. Installed Tor flows
remain a separate acceptance step after packaging.
