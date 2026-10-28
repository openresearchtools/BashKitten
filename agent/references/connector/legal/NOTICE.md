# References source and licenses

References derives its page detection, translation, save, item-selection, progress,
HTTP/cookie and attachment capture implementation from Zotero Connector 5.0.217,
commit ce29dfa360d1ce17a3a1f15a9d338d638a073106. Copyright Center for History and New
Media, George Mason University, Corporation for Digital Scholarship, and individual
contributors. See the preserved file headers and COPYING (AGPL-3.0-or-later; some
files are GPL-3.0-or-later). The upstream/source tree is a pristine source import.

Upstream repositories, immutable revisions, archive SHA-256 values and exact
materialized submodule selections are in upstream/SOURCE.json. Google Docs
integration and the desktop application are not part of the References runtime.
Translation dependencies retain their own COPYING/LICENSE and per-file notices.
SingleFile sources and license are preserved in the Connector lib/SingleFile tree.
The released package-lock.json pins JavaScript build/runtime dependencies.

BashKitten modifications, 28 October 2026: project/session authorization transport,
explicit pre-save destination choice, ordinary-tab selector/challenge presentation,
References product branding, and removal of upstream cloud/reporting/update paths.
These changes are recorded as named patches and small source modules separately
from the original source. Zotero names in source/protocol/license information are
attribution or compatibility identifiers, not References product branding.
