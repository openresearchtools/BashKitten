# Android dependency source status — 19 October 2026

Release remains blocked. This record describes source/build evidence, not installed
browser acceptance, a traffic audit, or a change to the source requirements in the
frozen native-environments plan (`f71686dcb76402ec43bac3e6a7db8979ef0fb119`).

## Candidate evidence and scoped removal

The Android arm64 and x86_64 candidates from source
`bd393bd7ec59eebd3f540072dc9511917520de9c` (parent run `39303133963`, Android
run `39304020490`) each contain 284 resolved Maven coordinates. The source archive
contains 263 source JARs and reports 21 coordinates without source JARs: 15 runtime
SDKs and six BOM/common/empty-artifact entries. DEX inspection independently found
FIDO, Play Integrity and Install Referrer classes in the actual APKs. Existing
Google license terms identify their grants; they do not supply missing source.

The scoped correction removes `com.android.installreferrer:installreferrer:2.2`
and `com.google.android.gms:play-services-ads-identifier:18.3.0` from Fenix's
runtime dependencies. It removes the install-referrer client/worker/services,
activation ping and advertising-ID hashing, their startup/analytics/onboarding
callers, and the associated obsolete upstream tests. Shared distribution value
metadata remains in `UTMParams`; it has no Play client or reporting method.
Historical notices and original Mozilla attribution remain retained.

The updated Gradle dependency graph has 282 Maven coordinates. Fenix release
Kotlin and Java compilation succeeds using the existing Android build environment.
The actual OSS dependency set passes the updated pinned notice inventory and full
notice checksum validation. These checks do not establish APK absence or device
behavior; both need the next complete candidate after the source blocker is fixed.

`stageBashKittenDependencySources` now clears stale output, records unresolved
components as well as absent source artifacts, and fails when any remain.
`collect-artifacts.py` rejects an incomplete receipt before signing or copying a
candidate. These gates deliberately do not treat a license as source or add a
closed-library exception. Artifactless metadata entries still need explicit
review and retained provenance; the gate currently conservatively rejects them.

## Remaining dependency owners

| Owner | Remaining dependencies without collected source |
| --- | --- |
| GeckoView WebAuthn | Play Services FIDO 21.3.0; transitive base/basement 18.10.0 and tasks 18.4.1 |
| Fenix Play Integrity / Mozilla MLPA | Play Integrity 1.6.0 and shared core-common 2.0.4; shared GMS tasks/basement |
| Fenix Play review prompts | review and review-ktx 2.0.2; shared core-common/tasks/basement |
| Fenix Firebase push | cloud-messaging 17.2.0, stats 17.0.2, firebase-annotations 17.0.0, firebase-iid-interop 17.1.0, firebase-measurement-connector 19.0.0; shared GMS dependencies |

The Integrity warmup is disabled in `FenixApplication`, but its concrete client is
still referenced by `Components`, the Mozilla MLPA provider, `ClientUUID` and
upstream debug controls. Removing only its Gradle line leaves uncompilable paths.
Those unrequested product paths still require a focused removal with their
callers; this change does not claim they were removed. Firebase's dependencies
also serve WebPush, so removing them requires a separate functional trace, not a
classification of every push dependency as analytics.

The 263 matching JARs are downloaded by the source collector and hashed during
packaging. They are not yet a committed, materialized source corpus/checksum lock.
The Maven notice manifest pins legal input files, not all of those runtime source
archives. Source-complete packaging therefore needs that independent correction
even after the unresolved coordinates have been addressed.

## WebAuthn compatibility boundary

GeckoView already includes `WebAuthnCredentialManager.java`, which calls the open
Android framework credential API on Android 14 and newer. `WebAuthnTokenManager`
still uses GMS for older Android, credential lookup and legacy/non-discoverable
credentials, fallback when the framework cannot fulfill a request, and the
platform-authenticator availability query. Fenix supports Android API 31 and
newer. No no-GMS build switch was found in the pinned GeckoView build path.

Android documents that browser-origin requests work on API 34 and newer and need
credential-provider approval; Google Password Manager specifically requires
approval of the browser. The provider checks package/signing identity. See
[privileged-app credential requests](https://developer.android.com/identity/sign-in/privileged-apps)
and [calling-app verification](https://developer.android.com/reference/androidx/credentials/provider/CallingAppInfo).
The framework path is not evidence of an equivalent replacement for all existing
GMS behavior. The upstream AndroidX guidance explicitly identifies Google Play
Services as proprietary: [open-source integration guidance](https://android.googlesource.com/platform/frameworks/support/+/f26f9242406a472b524c2897c6e57f0c482ae188/docs/open_source.md).

No FIDO dependency, origin check, supported Android version or browser security
path was changed. Preserving the current contract requires corresponding source
for the retained SDKs or a verified equivalent open implementation; neither has
been established. A narrow source-policy exception would require explicit user
authorization. A framework-only design would require an explicit compatibility
decision plus provider/credential/device acceptance, and cannot be represented
as preserving all existing functionality. No such exception or reduction is
implemented here.
