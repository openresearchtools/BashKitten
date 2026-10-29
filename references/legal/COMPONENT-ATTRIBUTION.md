# References: reused components and BashKitten adaptations

References is BashKitten's reference-management component. It selectively reuses
and adapts components and behavior from Zotero, the Citation Style Language
project, Systematic Reviewer and the native Office stack. It is not the Zotero
desktop application or a standard whole-application Zotero fork. BashKitten owns
the project databases, authorization, service lifetime, user/Pi API and product
integration. The Zotero desktop application's account, sync and application UI
are not bundled as a backend.

Upstream names identify the source and its authors. References uses BashKitten
names and artwork; these adaptations do not imply endorsement by Zotero,
Collabora, LibreOffice, the Citation Style Language project or their contributors.
Original copyrights, source headers and full license texts remain applicable.

The links below distinguish immutable upstream source from BashKitten's current
adapter source. Each adapter has an online link and a relative offline link.
Relative source links resolve in the corresponding-source checkout; selected
runtime files are also installed with References. Full pristine donor sources,
named patches and original source archives belong to the corresponding-source
distribution. The package's [runtime manifest](../runtime-payload.json) specifies
what is actually installed; this source map is not a claim that every donor
application or test suite is in the runtime.

| Reused component and pinned upstream source | BashKitten use and modification | Our adapter source and retained terms |
| --- | --- | --- |
| **Zotero data schema**, [`70c3aa98` schema.json][schema] | Native item types, fields, creator types and CSL mappings supply editable metadata. Project storage and additional work-identifier fields belong to References. The upstream schema stays pristine. | [translation][bk-translation] ([offline](../translation.mjs)), [SQLite store][bk-store] ([offline](../store/worker.mjs)); schema's [original distribution information][schema-readme] and [pin](../vendor/schema/source.json) are retained. |
| **Zotero translators**, complete pinned translator set at [`c8300377`][translators], including [OpenAlex JSON][openalex-translator] | Native import, identifier search, export and provider metadata mapping are reused. The OpenAlex input adapter fills specific sanitation, creator-identity and identifier gaps; ordinary personal names retain native parsing. Runtime copies omit translator test tails while retaining source headers. | [translation][bk-translation] ([offline](../translation.mjs)), [OpenAlex adapter][bk-openalex] ([offline](../adapted/openalex.mjs)); original per-file licenses and copyrights, with AGPL-3.0-or-later where declared. See [OpenAlex adaptation details](OpenAlex-metadata-adaptation.json). |
| **Zotero translation engine**, [`d08300c2`][translate], and **translation-server Node hosts**, [`672d4f3b`][translation-server] | The native engine and Node transport/sandbox facilities run selected translation work in the existing worker. Node module paths, private preferences, cancellation and backend transport replace desktop hosts. Automatic translator failure reporting is physically removed; the upstream cloud/serverless service graph is not included. | [runtime hosts][bk-runtime] ([offline](../runtime/)), [worker][bk-worker] ([offline](../native-worker.mjs)); AGPL-3.0-or-later and preserved embedded notices. |
| **Zotero Utilities**, [`1dd38e27`][utilities], and pinned Zotero [Item/Extra conversion][item-source] at `536244c2` | Native creator parsing, date handling, item/CSL conversion, filename rules and Extra-field preservation are reused. Small hosts connect them to References records and attachment storage. | [item adapter][bk-item-extra] ([offline](../runtime/item-extra-native.js)), [attachment naming][bk-attachment] ([offline](../attachment-names.mjs)); AGPL-3.0-or-later plus the original embedded MIT/BSD and other notices in [the component inventory](Utilities-third-party-source.json). |
| **Zotero PDF resolver and request behavior**, [attachments.js][attachments] and [http.js][http] at `536244c2` | Native resolver selection, request queue, per-domain pacing, retries and custom-resolver syntax are reused. Node/file hosts and the existing authorized browser capture path replace desktop services. Browser-required retrieval uses ordinary session tabs. | [resolver][bk-resolvers] ([offline](../resolvers.mjs)), [native queue host][bk-resolver-native] ([offline](../runtime/resolver-native.js)), [HTTP host][bk-http] ([offline](../runtime/http.js)); AGPL-3.0-or-later and retained source notices. |
| **citeproc-js as bundled by Zotero**, [citeproc.js][citeproc], with native [Style][style] and [Cite][cite] at `536244c2` | The full processor and native style/locale/link/bibliography settings are reused. In-memory style/item/locale lookup and the ordered document state replace desktop hosts; this is not a replacement citation-formatting algorithm. | [processor adapter][bk-citeproc] ([offline](../runtime/citeproc-native.js)), [citation service][bk-citations] ([offline](../citations.mjs)); Frank Bennett and contributors' CPAL-1.0-or-later **or** AGPL-3.0-or-later notice is preserved, with BashKitten selecting AGPL-3.0-or-later for this distribution. Zotero's surrounding code retains its own notices. |
| **Citation Style Language styles and locales**, [styles `e98c3b8a`][styles] and [locales `8bef426f`][locales] | Pinned styles/locales and their author/contributor metadata feed the native processor. They are separate content from the engine. | [citation service][bk-citations] ([offline](../citations.mjs)); CC-BY-SA-3.0, with the [full license](CC-BY-SA-3.0.txt), [provenance](CC-BY-SA-3.0-source.json) and original style/locale notices retained. |
| **Zotero classic citation dialog**, [addCitationDialog.js at `188c54c1`][classic] (7.0.32) | Classic citation selection/editing behavior is adapted into the shared web chooser used by References and the three Office adapters. BashKitten supplies the compact, responsive table/chip UI and bounded project API. | [shared chooser][bk-chooser] ([offline](../web/shared-citation-dialog.js)); AGPL-3.0-or-later, original copyright and the [exact source manifest](../vendor/classic-dialog/source.json). |
| **Zotero Connector**, [5.0.217, `ce29dfa3`][connector] | Native page detection, translation/save, item selection, progress, request/cookie and attachment capture logic are adapted to the chosen References backend/project. Named patches add the existing authorization transport and References branding and remove upstream cloud/reporting/update paths. Google Docs integration is excluded. | [capture adapter][bk-connector] ([offline source](../connector/src/references.js)), [named patches][bk-connector-patches] ([offline source](../connector/patches/)); AGPL-3.0-or-later, GPL-3.0-or-later where declared, and each dependency's original terms. [Connector notice](../connector/legal/NOTICE.md) and [source/submodule manifest](../connector/upstream/SOURCE.json) preserve its separate exact dependency pins. |
| **Systematic Reviewer**, [V3 base `3224958e`][reviewer-v3] with its recorded frozen local delta, and [reviewed main `859824b1`][reviewer-main]; native Zotero [merge preservation][merge] at `536244c2` | V3 supplies strict identifier/abstract/provenance rules. Selected main-branch normalization, exact-identifier lookup and old-key behavior inform the existing SQLite owner. One shared exact work identifier is sufficient for a merge in one project database; alternate identifiers/source history and all distinct attachments remain. No title/author fuzzy matcher, second identity service or whole reviewer application is imported. | [identity adapter][bk-identity] ([offline](../adapted/work-identity.mjs)), [OpenAlex adapter][bk-openalex] ([offline](../adapted/openalex.mjs)), [store][bk-store] ([offline](../store/worker.mjs)); AGPL-3.0-or-later, [V3 source record](Systematic-Reviewer-source.json), [OpenAlex](OpenAlex-metadata-adaptation.json) and [identity](Work-identity-adaptation.json) adaptation records and [full reviewer license](Systematic-Reviewer-LICENSE). |
| **Native Office citation facilities and behavior**, Collabora Online/Office engine [commit `42745e44`][office-source], its [Zotero field integration][office-zotero] and [UNO text-field API][office-uno]; Zotero's [integration behavior][integration] and [bibliography parameters][cite] at `536244c2` | The replaceable References Office plugin uses native Writer fieldmarks, Calc/Impress anchors/attributes, UNO/script sessions, native undo and the native save/export engine. Bibliography parameters come from Zotero's Cite code. Writer text/style updates follow the reviewed native LibreOffice integration behavior described below. The plugin shares References' chooser/processor and does not bundle the desktop Zotero LibreOffice extension. | [Office plugin][bk-office-plugin] ([offline source](../../office/extension/kit.mjs)), [citation orchestration][bk-office-citations] ([offline source](../../office/extension/citations.mjs)), [Office integration description][bk-office-readme] ([offline source](../../office/README.md)). BashKitten's authored Office plugin is AGPL-3.0-only; reused components keep their own licenses. Collabora/LibreOffice source retains MPL-2.0 and the original LGPL/GPL/Apache and third-party notices where applicable; see [Office's preserved attribution](../../office/branding/ATTRIBUTION.txt) and [license inventory](../../office/upstream/online/source.json). |

Writer text and bibliography-style behavior was checked against Zotero's pinned
LibreOffice integration, commit `227551c1644c6cb1156226d4db5d1b293fdb271d` selected
by Zotero `536244c2`: [ReferenceMark.setText][lo-mark] and
[Document.setBibliographyStyle][lo-document]. BashKitten's JavaScript/UNO adapter
follows that behavior, including the native Bibliography 1 paragraph style; it
does not ship the donor Java extension. The inspected Java files declare
AGPL-3.0-or-later and retain the donor repository's [AGPL COPYING][lo-copying];
this does not assign that license to the whole Office stack.

**License scope and source availability.** This document is a source map, not a
replacement license or a declaration that one GPL/AGPL notice covers every
dependency. Zotero and its contributors, Frank Bennett and citeproc-js
contributors, CSL style/locale authors, Systematic Reviewer contributors,
Collabora/LibreOffice contributors and all other named copyright holders retain
their notices. MIT-licensed wicked-good-xpath, Utilities' embedded fragments,
Connector/SingleFile dependencies and runtime npm packages keep their actual
MIT, BSD, GPL, AGPL, MPL or other recorded terms. Full grants and notices are
collected by the existing package inventories, including each component's
`source-licenses.json`/`licenses.json`, the Connector legal inventory and the
[References npm source pins](../vendor/npm/sources.json). Original source headers
and dual-license choices are retained; BashKitten modifications are marked in
our source, [named adaptation record](../runtime/provenance.json) and patches.

This document is included in References' existing legal payload and therefore in
BashKitten's generated offline About/license inventory. It describes current
source reuse and does not assert installed product acceptance, feature parity or
upstream approval.

[schema]: https://github.com/zotero/zotero-schema/blob/70c3aa98627413d6a30dca955886eafbde085ce9/schema.json
[schema-readme]: https://github.com/zotero/zotero-schema/blob/70c3aa98627413d6a30dca955886eafbde085ce9/README.md
[translators]: https://github.com/zotero/translators/tree/c83003773b65359e41466e1d419b2d1df5512af7
[openalex-translator]: https://github.com/zotero/translators/blob/c83003773b65359e41466e1d419b2d1df5512af7/OpenAlex%20JSON.js
[translate]: https://github.com/zotero/translate/tree/d08300c2c01a4d6ef325f05cbefc6c138a99f811
[translation-server]: https://github.com/zotero/translation-server/tree/672d4f3b6254c3afd4d62cdeef5aed7602d84078
[utilities]: https://github.com/zotero/utilities/tree/1dd38e27edf81e9d9c4161c957b7efb7f5681ac3
[item-source]: https://github.com/zotero/zotero/blob/536244c2771f590abab9c09a3c27e615e0b318ff/chrome/content/zotero/xpcom/data/item.js
[attachments]: https://github.com/zotero/zotero/blob/536244c2771f590abab9c09a3c27e615e0b318ff/chrome/content/zotero/xpcom/attachments.js
[http]: https://github.com/zotero/zotero/blob/536244c2771f590abab9c09a3c27e615e0b318ff/chrome/content/zotero/xpcom/http.js
[citeproc]: https://github.com/zotero/zotero/blob/536244c2771f590abab9c09a3c27e615e0b318ff/chrome/content/zotero/xpcom/citeproc.js
[style]: https://github.com/zotero/zotero/blob/536244c2771f590abab9c09a3c27e615e0b318ff/chrome/content/zotero/xpcom/style.js
[cite]: https://github.com/zotero/zotero/blob/536244c2771f590abab9c09a3c27e615e0b318ff/chrome/content/zotero/xpcom/cite.js
[styles]: https://github.com/citation-style-language/styles/tree/e98c3b8a5371ad571abcf2192b75dfdd392243f2
[locales]: https://github.com/citation-style-language/locales/tree/8bef426f89f38c0789223c50e53ec2197bc50bb3
[classic]: https://github.com/zotero/zotero/blob/188c54c186fbbaa6889145986d43ba64160a44fa/chrome/content/zotero/integration/addCitationDialog.js
[connector]: https://github.com/zotero/zotero-connectors/tree/ce29dfa360d1ce17a3a1f15a9d338d638a073106
[reviewer-v3]: https://github.com/openresearchtools/systematic-reviewer/tree/3224958eac9f58a92173b177f4adde78f5bbc018
[reviewer-main]: https://github.com/openresearchtools/systematic-reviewer/tree/859824b115731cb9932cdd45b130b8f4d222daac
[merge]: https://github.com/zotero/zotero/blob/536244c2771f590abab9c09a3c27e615e0b318ff/chrome/content/zotero/mergeItems.mjs
[integration]: https://github.com/zotero/zotero/blob/536244c2771f590abab9c09a3c27e615e0b318ff/chrome/content/zotero/xpcom/integration.js
[office-source]: https://github.com/CollaboraOnline/online.mirror/tree/42745e44dd8530fac7acd5f46cb7571ceea63c6a
[office-zotero]: https://github.com/CollaboraOnline/online.mirror/blob/42745e44dd8530fac7acd5f46cb7571ceea63c6a/browser/src/control/Control.Zotero.js
[office-uno]: https://github.com/CollaboraOnline/online.mirror/blob/42745e44dd8530fac7acd5f46cb7571ceea63c6a/engine/offapi/com/sun/star/text/TextField.idl
[lo-mark]: https://github.com/zotero/zotero-libreoffice-integration/blob/227551c1644c6cb1156226d4db5d1b293fdb271d/build/source/org/zotero/integration/ooo/comp/ReferenceMark.java
[lo-document]: https://github.com/zotero/zotero-libreoffice-integration/blob/227551c1644c6cb1156226d4db5d1b293fdb271d/build/source/org/zotero/integration/ooo/comp/Document.java
[lo-copying]: https://github.com/zotero/zotero-libreoffice-integration/blob/227551c1644c6cb1156226d4db5d1b293fdb271d/COPYING
[bk-translation]: https://github.com/openresearchtools/BashKitten/blob/main/references/translation.mjs
[bk-store]: https://github.com/openresearchtools/BashKitten/blob/main/references/store/worker.mjs
[bk-openalex]: https://github.com/openresearchtools/BashKitten/blob/main/references/adapted/openalex.mjs
[bk-runtime]: https://github.com/openresearchtools/BashKitten/tree/main/references/runtime
[bk-worker]: https://github.com/openresearchtools/BashKitten/blob/main/references/native-worker.mjs
[bk-item-extra]: https://github.com/openresearchtools/BashKitten/blob/main/references/runtime/item-extra-native.js
[bk-attachment]: https://github.com/openresearchtools/BashKitten/blob/main/references/attachment-names.mjs
[bk-resolvers]: https://github.com/openresearchtools/BashKitten/blob/main/references/resolvers.mjs
[bk-resolver-native]: https://github.com/openresearchtools/BashKitten/blob/main/references/runtime/resolver-native.js
[bk-http]: https://github.com/openresearchtools/BashKitten/blob/main/references/runtime/http.js
[bk-citeproc]: https://github.com/openresearchtools/BashKitten/blob/main/references/runtime/citeproc-native.js
[bk-citations]: https://github.com/openresearchtools/BashKitten/blob/main/references/citations.mjs
[bk-chooser]: https://github.com/openresearchtools/BashKitten/blob/main/references/web/shared-citation-dialog.js
[bk-connector]: https://github.com/openresearchtools/BashKitten/blob/main/references/connector/src/references.js
[bk-connector-patches]: https://github.com/openresearchtools/BashKitten/tree/main/references/connector/patches
[bk-identity]: https://github.com/openresearchtools/BashKitten/blob/main/references/adapted/work-identity.mjs
[bk-office-plugin]: https://github.com/openresearchtools/BashKitten/blob/main/office/extension/kit.mjs
[bk-office-citations]: https://github.com/openresearchtools/BashKitten/blob/main/office/extension/citations.mjs
[bk-office-readme]: https://github.com/openresearchtools/BashKitten/blob/main/office/README.md
