# Android product UI audit

Wild Buzzard uses the Firefox Android browser UI framework and Gecko engine,
with local browsing features and its own agent and Tor controls. Mozilla
accounts, Sync, telemetry services, sponsored content, VPN/Relay, translations,
Mozilla AI features, experiments and user-installed extensions are not product
features and must not be offered by the UI.

| Surface | Product behavior |
| --- | --- |
| Home and tab manager | Normal/private/Tor tabs, local history/bookmarks/quick access; no protection marketing, fox game, setup checklist, sponsored content or remote wallpaper UI. |
| Main and custom-tab menus | Browser navigation, bookmarks, history, downloads, passwords, desktop mode, per-tab adblocking and settings; no extensions, default-browser promotion or Mozilla VPN. |
| Main settings | Only shipped capabilities; no runtime Nimbus/account callbacks that can re-enable hidden entries. |
| Search and toolbar customization | Search engine controls and local suggestions; no Sync search, Firefox Suggest, translation shortcut or Mozilla AI gesture. |
| HTTPS, site permissions and tracking controls | Keep local security settings and explanations; remove Mozilla help buttons. Android DNS is used for ordinary sites; onion routing remains owned by Tor. |
| Passwords and autofill | Local storage and Android integration, without Sync initialization or sign-in rows. |
| About | Wild Buzzard version, project links, dependency libraries and locally packaged licenses/source notices. No dead about:rights/about:license buttons or secret debug menu. |
| Legacy entry points | Unsupported extension/AI deep links and about:addons/about:glean shortcuts no longer open feature screens. Website-triggered extension installation is not started. |
| Artwork | All main and build-channel drawable variants are inventoried in ui-artwork.json. Decorative art aliases the existing Wild Buzzard logo; functional vectors and error-page SVGs are independently drawn. Shared Android Components artwork is overridden by app resources. Structural shapes/selectors and license attribution remain. |

`wildbuzzard/android/scripts/generate-ui-artwork.py` records the original resource
hashes and generates app overrides. Upstream resource identifiers remain for
source compatibility; they do not imply the old artwork is used. Website
favicons/content, Android framework widgets, and license/source attribution are
not app branding.

Device verification of this change is pending the signed ARM64 build. Earlier
agent/Tor evidence in VALIDATION.md refers to its recorded source revisions.
