# References source and attribution

References is a BashKitten component built through selective component reuse and
adaptation. It is not the Zotero desktop application or a standard whole-app
Zotero fork. The [component source map](legal/COMPONENT-ATTRIBUTION.md) identifies
what was reused, each immutable upstream revision, BashKitten's modifications,
online/offline adapter source links and the applicable original terms. The same
map is included in BashKitten's generated offline About/license inventory.

References adapts reference-management facilities from the Zotero project,
https://www.zotero.org/, by the Corporation for Digital Scholarship and the
Center for History and New Media, George Mason University, and contributors.
The original copyright and license headers remain in each reused module.
The GNU Affero General Public License version 3 or later is reproduced in the
packaged legal information. References is a separate application boundary;
the desktop Zotero application is not part of the runtime payload.
Zotero, Collabora, LibreOffice and other upstream names are attribution and
compatibility references; BashKitten branding does not imply their endorsement.
The components retain their own licenses, including embedded and dual-license
terms. The BashKitten project license does not replace those individual terms.

The native translation engine, complete translators and schema, date and item
utilities, resolver selection and conservative request queue, and classic
citation-dialog behavior derive from the exact revisions recorded in
`vendor/*/source.json`. The archive checksums and pristine full source remain
in the source distribution. Runtime selection is explicit in
`runtime-payload.json`; only translator test-case tails are removed from the
runtime copies, with original headers and metadata retained.

Citation styles and locales are provided by the Citation Style Language (CSL)
project, https://citationstyles.org/, under Creative Commons
Attribution-ShareAlike 3.0 Unported, https://creativecommons.org/licenses/by-sa/3.0/.
All style author/contributor and locale translator metadata is retained. The
full CSL engine is the pinned Zotero distribution of citeproc-js by Frank G.
Bennett and contributors, including Zotero's changes. Its original dual-license
notice is retained with the runtime source and legal inventory; BashKitten selects
the AGPL-3.0-or-later option and includes the full license. Native Zotero Style
and Cite configuration supplies citation-engine settings and bibliography layout.

The wicked-good-xpath fork is the exact pinned Zotero translation-server
dependency. npm installs its original commit archive, verified by the recorded
SHA-256 and lockfile integrity; the runtime files match the earlier local npm
package of the same source. Its MIT license and source copyright notices remain.
Systematic Reviewer V3 supplies identifier normalization and resolution,
OpenAlex provenance and abstract-validation rules. Its frozen source and local
delta are preserved in the repository's Systematic Reviewer vendor directory;
its license and provenance are copied into this module's legal directory.

The OpenAlex metadata adapter keeps the pinned Zotero OpenAlex JSON translator
and native creator/schema conversion. Its small input, identifier and creator
fidelity adaptations are documented in
`legal/OpenAlex-metadata-adaptation.json`. Main-branch Systematic Reviewer
normalization behavior was inspected read-only at exact commit
`859824b115731cb9932cdd45b130b8f4d222daac`; the manifest records the reviewed
methods, complete source URLs and hashes. This did not replace the frozen V3
identifier or abstract modules with the main-branch application.

Exact work-identifier matching and old-item-key alias handling also reuse the
reviewed main-branch behavior. The project SQLite adaptation and native Zotero
merge/preservation methods are identified in
`legal/Work-identity-adaptation.json`. Their pristine pinned sources and complete
licenses remain in the corresponding vendor directories. All distinct attachment
records and bytes are retained; native attachment deduplication is not applied.

The native adaptations are identified in source headers and `README.md`:
Node host interfaces replace unavailable XPCOM interfaces; file storage and
authorization use the existing BashKitten backend owners; browser-required PDF
retrieval resumes through the existing authenticated capture helper. Automatic
translator reporting is removed. These are BashKitten modifications, not
changes attributed to the upstream projects.

The own-module `package-lock.json` pins every runtime npm dependency.
`vendor/npm/sources.json` records exact source URLs, integrity values and
SHA-256 checksums for the shared external source cache; package legal notices
are collected by the existing build inventory. No source archive, test suite,
development example or unused desktop resource is required in the application
runtime.
