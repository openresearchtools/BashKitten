# Citation assets

`author-date.csl` is an original, deliberately minimal author–date style under
this project's AGPL-3.0-or-later license. It is **not APA** and is not a substitute
for a journal's required style. Install this file into Zotero before refreshing
an export that uses it, or choose an installed independent CSL style when
rendering/exporting. Note/footnote styles are not supported in this release.

`locales-en-US.xml` is unmodified from the Citation Style Language locales
project, commit `8bef426f89f38c0789223c50e53ec2197bc50bb3`:
https://github.com/citation-style-language/locales/blob/8bef426f89f38c0789223c50e53ec2197bc50bb3/locales-en-US.xml

It is licensed CC BY-SA 3.0, not AGPL. Attribution: Andrew Dunning, Sebastian
Karcher, Rintze M. Zelle, Denis Meier and Brenton M. Wiernik, as recorded in its
`info` section. License: https://creativecommons.org/licenses/by-sa/3.0/
Legal code: https://creativecommons.org/licenses/by-sa/3.0/legalcode
Preserve this attribution and the embedded rights notice when redistributing.

Runtime dependencies carry their own licenses in their npm distributions.
`citeproc` is the citation-style processor; `fflate` provides pure JavaScript ZIP
support; the mdast/micromark packages parse Markdown. No bundled executable or
platform-specific binary is required by this package.
