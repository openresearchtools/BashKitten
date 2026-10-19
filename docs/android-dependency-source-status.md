# Android dependency source status — 19 October 2026

Release remains blocked by eight runtime source gaps after the removals and
source verification below. This record describes source/build evidence, not installed
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

`stageBashKittenDependencySources` now reconciles the actual Gradle graph with one
committed source inventory, validates every retained input checksum, clears stale
output and fails for coordinates without source. `collect-artifacts.py` rejects
an incomplete receipt before signing or copying a candidate and verifies staged
source checksums. These gates do not treat a license as source or add a
closed-library exception.

Six coordinates have no implementation needing a source JAR. Four are BOM POMs;
`kotlin-stdlib-common:2.3.21` has a POM and Gradle module redirecting to the separately
sourced `kotlin-stdlib:2.3.21`; the Guava `9999.0-empty-to-avoid-conflict-with-guava`
JAR contains only `META-INF`/Maven descriptors. Their exact POM/module/marker-JAR
bytes are retained and hashed in the same source inventory. The build verifies
that their selected runtime artifacts are absent or match the reviewed empty
artifact bytes. An unexpected runtime payload fails, rather than inheriting a
metadata exemption. At that stage the missing-source count was 13 runtime SDKs. The continuation
below removes four and establishes corresponding source for Firebase annotations.

## Further product-service removal and Firebase correspondence

The disabled Mozilla page-summary service had a complete MLPA provider, an
Integrity client, a persistent client UUID, token helpers, a summary fragment,
shake navigation and debug token controls. Its feature flag was already false
and its startup warmup was already disabled. The continuation removes these
service paths, their navigation/action callers and obsolete tests, and removes
the `lib-integrity-googleplay` / `lib-llm-mlpa` build edges. It also removes the
unused shake/accelerometer dependencies. Shared local summary preference code
remains disabled; no replacement service or dummy provider was introduced.

Play Store rating prompts are another upstream product service. Their old
eligibility middleware could still run without telemetry, so they were not
assumed unreachable merely from the telemetry switch. The continuation removes
the controller, prompt UI/binding, trigger actions/state/middleware, obsolete
preferences/migration, navigation and their tests. It removes the direct review
and review-ktx dependencies. These removals do not touch browsing, accounts,
WebAuthn, Firebase push or protected browser-origin checks.

The source corpus now retains 261 original source JARs with exact coordinates
and SHA-256 pins under `browser/bashkitten/android/sources`. Two Lifecycle
testing JARs left the runtime graph with the shake module and were removed from
the current corpus. Their original imports remain recoverable in Git. Staging
copies only currently resolved dependencies.

`com.google.firebase:firebase-annotations:17.0.0` now has verified corresponding
public source. Its official [version declaration](https://github.com/firebase/firebase-android-sdk/blob/bcaf4c38b9dcdafcf9ded322d689a0aa18214f7d/firebase-annotations/gradle.properties)
selects 17.0.0. The later [released-version record](https://github.com/firebase/firebase-android-sdk/blob/8cc3e8157689ebfe55144c3a4575a936c49d0d47/firebase-annotations/gradle.properties)
confirms 17.0.0 was released. All six annotation classes compile byte-for-byte to
the published JAR's complete class set using Java 8 source/target and the pinned
`javax.inject:javax.inject:1` dependency. The original module files, build/version
metadata, upstream LICENSE and README are materialized in a deterministic source
snapshot. The existing source inventory records the exact commit, per-file and
archive hashes, published binary hash and six matching class hashes. Builds
verify the selected runtime JAR still matches that binary identity. This does
not invent a release tag or republish decompiled code.

The actual post-removal Gradle graph has 276 Maven coordinates: 268 with
verified source/metadata coverage and the eight unresolved coordinates below.
The stage validated all 270 required files (261 source JARs, the annotations
snapshot, and eight metadata files), including the selected annotations binary
identity. Release Kotlin/Java compilation succeeds. Exact offline notice coverage
and all pinned legal-text checksums pass. Both the Gradle stage and the artifact
collector reject the eight unresolved coordinates; the latter does so before
signing or copying a candidate. This is a bounded compile/dependency/source
check, not a full APK build or installed feature/traffic acceptance.

## Remaining dependency owners

| Owner | Dependencies still without verified corresponding source |
| --- | --- |
| GeckoView WebAuthn | `com.google.android.gms:play-services-fido:21.3.0` |
| Shared WebAuthn/push dependencies | `com.google.android.gms:play-services-base:18.10.0`, `com.google.android.gms:play-services-basement:18.10.0`, `com.google.android.gms:play-services-tasks:18.4.1` |
| Firebase push | `com.google.android.gms:play-services-cloud-messaging:17.2.0`, `com.google.android.gms:play-services-stats:17.0.2` |
| Firebase Messaging's optional IID/analytics interfaces | `com.google.firebase:firebase-iid-interop:17.1.0`, `com.google.firebase:firebase-measurement-connector:19.0.0` |

The six GMS libraries are in the proprietary Play Services family. The two
remaining Firebase AARs declare the Android SDK License in their exact published
POMs; the official Firebase repository has no corresponding module or path
history for either. Its README excludes Analytics from its open SDK coverage.
The IID AAR contains two interface classes, and the measurement connector AAR
contains four interface/data classes. They are real class payloads, not code-free
BOMs, and no verified official matching source publication was found. This is a
bounded finding about these versions, not a claim that every Firebase SDK is
closed.

The pinned public `firebase-messaging:25.0.2` source directly names both types:
`FirebaseMessagingRegistrar` resolves the optional IID interface and constructor
signatures retain it; `FirebaseMessaging` and `MessagingAnalytics` reference the
analytics connector. Excluding the AARs alone could break class loading, so this
change preserves the functional push graph. Building a narrowly adapted
Firebase Messaging source module without those optional integrations would
require a separate source/build/FCM acceptance change. It would not supply the
six GMS sources or replace their WebAuthn and push behavior.

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
path was changed. Keeping the current functionality and source requirement needs
corresponding licensed source for the retained SDKs or a verified equivalent open
implementation; neither has been established. A framework-only design would
require an explicit compatibility decision plus provider/credential/device
acceptance, and cannot be represented as preserving all existing functionality.

### Provider-specific trust and ordinary passwords — 19 October continuation

Google Password Manager's approval is not a universal Android passkey-provider
approval. Released Bitwarden Android `v2026.10.0-bwpm`, peeled commit
`747801fc0867b7c9f1efedc3802249a458f19619`, checks its bundled Google and community
browser lists, then a persisted local user trust list. Its
[origin validation](https://github.com/bitwarden/android/blob/747801fc0867b7c9f1efedc3802249a458f19619/app/src/main/kotlin/com/x8bit/bitwarden/data/credentials/manager/OriginManagerImpl.kt#L66)
and [trust prompt](https://github.com/bitwarden/android/blob/747801fc0867b7c9f1efedc3802249a458f19619/app/src/main/kotlin/com/x8bit/bitwarden/ui/vault/feature/itemlisting/VaultItemListingViewModel.kt#L2479)
permit a user to approve an unrecognized browser locally; the
[repository](https://github.com/bitwarden/android/blob/747801fc0867b7c9f1efedc3802249a458f19619/app/src/main/kotlin/com/x8bit/bitwarden/data/credentials/repository/PrivilegedAppRepositoryImpl.kt#L146)
binds that approval to the actual package and signing certificate. Signature
mismatches have a separate error path. `com.bashkitten` is absent from both
bundled lists; the explicit user-trust path is relevant, not a claim that the
browser is preapproved. No Google registration or provider submission occurred.

This provides a source-supported third-party-provider path to test on Android
14 and newer without making Google approval a prerequisite. It does not prove
the installed BashKitten APK's registration/sign-in flows, every website/native
app, or older Android behavior. Bitwarden must hold a credential registered with
the relying party; trusting a browser does not expose keys held only by Google
Password Manager. Native app asset-link validation is a distinct path from a
browser's delegated website origin. The source-only framework adapter must still
preserve origin validation, actual capability reporting, cancellation and errors;
deleting the FIDO Gradle edge while leaving its callers is insufficient.

Ordinary password saving and autofill are independent of WebAuthn/provider
approval. The retained Fenix `Settings.kt` defaults `shouldPromptToSaveLogins` and
`shouldAutofillLogins` to true, and `BaseBrowserFragment` binds both to the existing
password-storage/prompt feature. Local saving/autofill needs no Google approval
or Mozilla Sync account. This is source evidence, not a newly completed installed
password-manager test. Removing the FIDO integration alone would also leave the
separate Firebase/WebPush dependency chain above unresolved. No passkey, push or
password feature was changed by this research record.

Project source-policy approval and AGPL/GPL license compatibility are separate
requirements. The user has not authorized retaining the proprietary SDKs. Even
an explicit project waiver, binary checksum inventory or full notices would not
cure incompatible license terms or supply missing copyright permissions.
[AGPLv3 section 1](https://www.gnu.org/licenses/agpl-3.0.html#section1) defines
Corresponding Source and the specific System Libraries exclusion;
[section 10](https://www.gnu.org/licenses/agpl-3.0.html#section10) prohibits
further restrictions on the rights it grants. Any claimed system-library or
separate-work basis must be established for the actual components, their terms
and their integration. This record does not assume that the Google SDKs qualify.

Where a linking exception is needed, valid permission must come from the
copyright holders of the affected covered code; project approval cannot grant
an exception for third-party code whose holders have not granted it. The
[GNU FAQ on incompatible libraries](https://www.gnu.org/licenses/gpl-faq.en.html#GPLIncompatibleLibs)
explains that distinction. Applicable SDK permissions must also be satisfied.
No licensing exception, product change or compatibility reduction is implemented
here. This record does not certify AGPL/GPL compatibility; release remains
blocked until both the project source requirements and the applicable license
obligations are satisfied.
