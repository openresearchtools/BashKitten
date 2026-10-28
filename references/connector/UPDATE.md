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
   capture ID, host ID and API contract. About References reads the installed
   version through `browser.runtime.getManifest()`. Record the source revision and pinned translator
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
   versioned filename, for example `references-1.0.2-signed.xpi`. Compute its
   SHA-256 separately: signing changes the package bytes. Keep the signed and
   unsigned digests distinct. Record the actual ID/version, host API, source
   revision, signer result and signed digest alongside the existing BashKitten
   release artifacts. A filename or ZIP signature entry is not proof of valid
   signing; the native installer must accept the signed package.
5. Retain the previously accepted signed XPI and its digest for rollback. Deliver
   the new signed XPI through the existing release/manual artifact path with its
   expected version and digest. Signing account credentials stay outside sources,
   build inputs and logs.

The review source bundle must preserve the repository-relative paths for
`references/connector/` (excluding generated `.build/` and `dist/`),
`references/vendor/translators/`, `agent/packaging/source_cache.py`, and the branding `LICENSE` plus
`default16.png`, `default32.png`, `default64.png` and `default128.png` under
`browser/bashkitten/browser/branding/`. These are the build's complete source and
asset inputs; a whole Mozilla checkout is not needed. Run the command above from
that bundle's root with Python, Git, Bash, Node.js and npm available. The 1.0.2
offline build used Python 3.14.4, Node.js 22.22.1 and npm 9.2.0. Preserve the exact
source revision with the bundle and compare the rebuilt unsigned XPI digest
before submission. Include the matching verified download-cache inputs from
`vendor/npm/SOURCES.json`; set `BASHKITTEN_SOURCE_CACHE` to that extracted cache
and `BASHKITTEN_OFFLINE_SOURCES=1` for an offline rebuild.

No signed References XPI or control of its Mozilla add-on record has been
established by this work. The generated artifact remains unsigned. Signing and
review rejection are release gates; do not bypass them or change signature prefs.

### Signing prerequisites and data declaration

Mozilla requires new add-ons submitted since 3 November 2025, including unlisted
ones, to declare their data transmission in the manifest. The package declares
`browsingActivity` for captured page URLs/referrers and `websiteContent` for
reference metadata, notes/tags and requested snapshots/PDFs. This is the capture
function's transfer to the user's selected backend, which may be remote; it is
not a claim of analytics collection. Publisher requests use the existing browser
website session. The About page explains this flow. No `technicalAndInteraction`
permission or `has_previous_consent` assertion is added.

The required categories use Gecko's existing installation prompt. The manifest
requires desktop 140 and Android 142, which support this prompt; it does not add
a custom consent implementation or weaken the existing remote route. See
Mozilla's [native data consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

The remaining release inputs are an authorized Mozilla developer account with
control of the exact capture ID, an accepted source/build submission and its
returned signed XPI, plus a versioned downloadable artifact and its digest. Account
control and signing acceptance must be established by the release owner; they
are not supplied by this repository. For a rollback acceptance run, retain two
accepted compatible signed versions. The existing unsigned 1.0.0/1.0.1 build
artifacts are not signed rollback packages and must not be relabelled as such.
Keep the returned signed bytes and digests separate from the deterministic
unsigned build inventory. Desktop and Android have the native manual entry
points described below; both targets' installed upgrade/restart/downgrade proof
remains open.

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

Download the accepted signed XPI through the existing release/manual artifact
path, then open the **BashKitten settings gear → Update References from file**.
Choose the downloaded package in Android's document picker and confirm the
native permission prompt. This menu entry is source-wired for the next browser
package; it is not present in earlier sealed candidates. The capture logic can
then be replaced through this entry without rebuilding that browser package.

Check the installed version through **References Add → Source and licenses →
About References**, exercise capture, restart, and check the version again. For
rollback, choose the retained compatible earlier signed XPI through the same
entry, without uninstalling first. A normal HTTPS XPI hyperlink is only a
download on Android: it does not invoke the desktop XPI content handler.

The downstream native install path exists: `AddonManager.installAddon` →
`GeckoEngine.installWebExtension` → `WebExtensionController.install` →
`GeckoViewWebExtension.installWebExtension` → native AddonManager. Its required
permission handler checks the verified extension ID and rejects anything except
`references@bashkitten.org` before activation. Gecko checks the manifest and
signature before that prompt. No signature setting is changed.

`BashKittenMenuDialog` invokes the existing `AddonFilePicker`, registered by
`HomeActivity` before its lifecycle reaches STARTED. The picker copies the chosen
document into a unique private cache directory on the IO dispatcher, then calls
the existing `AddonManager` with `InstallationMethod.FROM_FILE`. Native install
success/failure, or cancellation before handoff, cleans that temporary directory.
This is a small caller/lifecycle adaptation, not a separate installer or updater.

Native AddonManager supports the same manual downgrade mechanism as desktop.
`ReferencesHost.install` preserves an existing non-built-in capture instead of
reinstalling the APK version; the fixed host remains on APK-resource
`ensureBuiltIn`. These are source-supported mechanisms, not an installed Android
update/rollback result. Mozilla's [self-distribution documentation](https://extensionworkshop.com/documentation/publish/self-distribution/)
also distinguishes Android file installation from desktop web-download installs.

Relevant source: `browser/mobile/android/android-components/components/feature/addons/src/main/java/mozilla/components/feature/addons/ui/AddonFilePicker.kt`,
`AddonManager.kt`, `browser/engine-gecko/.../GeckoEngine.kt`,
`browser/mobile/android/fenix/app/src/main/java/org/mozilla/fenix/bashkitten/BashKittenMenu.kt`,
`browser/mobile/android/fenix/app/src/main/java/org/mozilla/fenix/HomeActivity.kt`,
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
