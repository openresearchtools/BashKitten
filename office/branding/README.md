# Office branding inputs

The product name is **Office**, part of BashKitten. Its native About dialog says
“BashKitten integrated Office built on Collabora Online” and identifies its
LibreOffice technology. Upstream names remain in attribution, copyright,
licenses, protocol identifiers and source information.

These files use the actual branding facilities in the pinned
`cp-26.04.5-2` source, revision
`42745e44dd8530fac7acd5f46cb7571ceea63c6a`. Pristine source under
`office/upstream/online/source` is unchanged.

- `engine/` is passed to native `--with-branding`, with native
  `--with-product-name=Office` and `--with-vendor=BashKitten`. All seven required
  assets are present, preventing its missing-file fallback to donor artwork.
- `online/` is passed to native `--with-app-branding`, with native
  `--with-app-name=Office`, `--with-vendor=BashKitten` and the BashKitten
  `--with-info-url`. The pinned `browser/Makefile.am` copies `branding*` and
  `images/*.svg` into its own web distribution and copies `toolbar-bg-logo.svg`
  to the native `toolbar-bg.svg` location.
  The existing `collabora-office-white.svg` resource filename is preserved with
  Office artwork through the same supported image override, covering native
  backstage branding without changing its CSS or resource API.
- `branding.js` runs through native FileServer branding injection before the
  deferred editor bundle. It sets the native product-name, URL and logo
  globals, favicon and initial title. Native loading indicators, document
  titles and logo actions keep their existing owners.
- The native About action clones `#about-dialog`. The branding hook adds
  readable attribution and a local license link to that template; native
  version/copyright presentation and the original dialog remain in use.
  Asset/link URLs derive from the deployed branding script URL, preserving
  service-root and version-hash paths, HTTPS and forwarded routes.
- `0019-native-product-branding.patch` fixes one missing hook: the onboarding
  tour hardcodes its product title. The named patch substitutes the existing
  native product-name global, retaining an upstream fallback. Existing
  dynamic loading/title/error branding needs no patch. Disabled update
  notices and disabled upstream Zotero integration are unchanged.

`ATTRIBUTION.txt` is an installed legal-metadata input. The local
`branding-notices.html` page links complete, byte-identical copies of upstream
license/notice documents, the BashKitten AGPL and original artwork provenance.
`branding-engine-license.html` is the original upstream XHTML license listing,
including optional-component sections; the native package's generated legal
information records the actual built selection. The static page does not
replace installed legal files or corresponding-source artifacts.
`branding-sources.json` records exact copy origins and SHA-256 hashes.

`generate.py` derives these assets from the existing BashKitten PNG and
wordmark. The kitten PNG is embedded unchanged in SVG wrappers; its existing
colors are retained. The wordmark's existing light ink is fixed to that color
for Office's mandatory light UI. Intro rasters use the system DejaVu Sans
fonts whose hashes are recorded. Generation requires Python and Pillow,
performs no network operation and is a maintainer action rather than a
packaging/runtime dependency. Committed generated files are the build inputs.
Rerunning generation leaves identical files untouched.

Focused checks:

```sh
python3 office/branding/generate.py
node --check office/branding/online/branding.js
git apply --check --directory=office/upstream/online/source \
  office/patches/0019-native-product-branding.patch
```

The packaging helper checks the complete native configured asset selection and
installed asset hashes. Browser verification must open real Office, exercise
Help → About, follow the local licenses link, check the mobile About layout,
inspect the Office loading/title/logo surfaces and confirm a dark surrounding
OS/browser still shows a light Office UI/canvas. These source and asset checks
alone do not establish installed browser or platform acceptance.
