# Manual signed References capture updates and rollback

This procedure uses the existing native add-on installer. There is no component
update server, background updater, downloaded privileged host or new signing
trust root. Capture and the fixed host remain separate extension IDs:

| Component | ID | Installation boundary |
| --- | --- | --- |
| Capture | `references@bashkitten.org` | Built into BashKitten initially; replaceable by an ordinary Mozilla-signed profile XPI |
| Fixed host | `references-host@bashkitten.org` | Browser/APK resource only; changing its privileged API requires a browser build |

The current capture requires host API 1 and Connector API 3. Every host request
checks API 1 and fails on mismatch. Translator sources are pinned inside each
capture package; replacing a package does not download executable translators.

## Prepare a versioned package

1. Change `VERSION` in `build.py` for each distributable version. Keep the fixed
   capture ID, host ID and API contract. Update the version displayed in
   `src/references/about.html`. Record the source revision and pinned translator
   revision with the existing release's source notices.
2. Run `python3 references/connector/build.py`. Keep its unsigned
   `dist/references.xpi`, `dist/component.json` and `dist/runtime-sha256.json` as
   build evidence. The component metadata explicitly says `signed: false`.
3. The release owner submits the XPI through Mozilla's Add-ons Developer Hub
   using **On your own** (unlisted/self-distribution) and the same owned add-on
   record for subsequent versions. Include the exact corresponding sources,
   named patches, offline dependency archives, licenses and build instructions
   when source submission is required. Do not add an `update_url` for this manual
   workflow. See Mozilla's [signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
   and [submission instructions](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).
4. After signing succeeds, retain the returned signed XPI unchanged under a
   versioned filename, for example `references-1.0.1-signed.xpi`. Compute its
   SHA-256 separately: signing changes the package bytes. Keep the signed and
   unsigned digests distinct. Record the actual ID/version, host API, source
   revision, signer result and signed digest alongside the existing BashKitten
   release artifacts. A filename or ZIP signature entry is not proof of valid
   signing; the native installer must accept the signed package.
5. Retain the previously accepted signed XPI and its digest for rollback. Deliver
   the new signed XPI through the existing release/manual artifact path with its
   expected version and digest. Signing account credentials stay outside sources,
   build inputs and logs.

No signed References XPI or control of its Mozilla add-on record has been
established by this work. The generated artifact remains unsigned. Signing and
review rejection are release gates; do not bypass them or change signature prefs.

## Desktop manual installation and rollback

Open the native `about:addons` page, select the settings menu and **Install Add-on
From File**, choose the expected signed XPI, and confirm its native permission
prompt. Verify References' version and enabled state in the add-on details, then
exercise a capture in the installed browser. Check version/persistence again
after restart. The signed profile package takes precedence over the built-in
capture, while the fixed privileged host remains in the browser package.

For rollback, install the retained earlier signed XPI through the same native
file picker and verify its displayed version after restart. Do not uninstall
first: uninstalling deletes extension-local data. References detects component
version changes, including downgrades, and resets only its translator cache;
project libraries/attachments are owned by the backend outside the extension.
An older package must still support the installed host and backend API.

Native source evidence:

- `browser/toolkit/mozapps/extensions/content/aboutaddons-utils.mjs`,
  `installAddonsFromFilePicker`: native file chooser, `getInstallForFile`, native
  install/update prompt.
- `browser/toolkit/mozapps/extensions/internal/XPIProvider.sys.mjs`,
  `setupInstallLocations`: profile location precedes built-in locations.
- `browser/toolkit/mozapps/extensions/internal/XPIInstall.sys.mjs`,
  `loadManifest`/`newVersionReason`: signature, ID/type checks and explicit
  `ADDON_DOWNGRADE` lifecycle reason for a lower manually installed version.
- `browser/bashkitten/browser/app/profile/02-privacy.js`: signature checks remain
  enabled. This procedure does not modify them.

## Android manual installation and rollback

Open the exact signed XPI's **HTTPS link** from the existing BashKitten release
artifacts in an ordinary browser tab. Fenix's native download/install prompt
hands it to `AddonManager.installAddon` → `GeckoEngine.installWebExtension` →
`WebExtensionController.install` → `GeckoViewWebExtension.installWebExtension` →
native AddonManager. Confirm the normal permission prompt. Read the installed
capture version through References Add → Source and licenses → About References,
then verify persistence and a capture after restarting the app.

The narrowly restored Fenix `InstallationRequested` handler accepts HTTPS; it
checks the verified extension ID in the required-permission prompt and rejects
anything except `references@bashkitten.org` before activation. Gecko performs
manifest/signature verification before that prompt. The package's URL/name is
not its identity. No global add-on-signing check is changed. Source evidence
supports this path; a successful signed install has not yet been demonstrated.

For rollback, open the retained previous signed XPI's HTTPS link and follow the
same prompt, without uninstalling. A versioned package can be retained as a
normal existing release artifact; no custom updater or catalogue is required.
The same native downgrade mechanism applies as on desktop. `ReferencesHost.install`
skips built-in reinstall when a non-built-in capture with the same ID is present,
preserving the replacement across startup. The fixed host continues to use only
APK-resource `ensureBuiltIn`.

The pinned `AddonFilePicker` also supplies a document-picker installation API,
but Fenix does not currently wire that utility into a screen. **Do not instruct
users to find an Android “Install extension from file” menu that is absent.** The
implemented manual flow uses the existing HTTPS install prompt. At the initial
review that prompt had been suppressed; the native owner restored only this
References-scoped path. Candidate build/installed verification remains required.

Relevant source: `browser/mobile/android/android-components/components/feature/addons/src/main/java/mozilla/components/feature/addons/ui/AddonFilePicker.kt`,
`AddonManager.kt`, `browser/engine-gecko/.../GeckoEngine.kt`,
`browser/mobile/android/geckoview/src/main/java/org/mozilla/geckoview/WebExtensionController.java`,
`browser/mobile/shared/modules/geckoview/GeckoViewWebExtension.sys.mjs`,
`browser/mobile/android/fenix/app/src/main/java/org/mozilla/fenix/extension/WebExtensionPromptFeature.kt`,
and `browser/mobile/android/bashkitten/src/main/java/com/bashkitten/ReferencesHost.java`.

## Development reload and remaining evidence

Desktop `about:debugging` can temporarily load the unpacked capture manifest and
reload it without rebuilding Mozilla. This is development only, does not persist
as a distributable signed update, and grants no new host privileges. Do not use
`ensureBuiltIn` with downloaded files or relax signing for Android development.

Installed acceptance remains pending: signed upgrade, restart persistence,
signed downgrade, incompatible host handling, rejection of unsigned/tampered or
wrong-ID input on the restricted Android flow, continued capture/manager/resolver
function, and unchanged protected host. Source inspection and the unsigned
source build are not those installed results.
