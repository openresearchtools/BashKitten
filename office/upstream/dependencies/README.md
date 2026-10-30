# Native Office dependency inputs

The pristine Collabora Online `cp-26.04.5-2` and paired engine `26.04.5.2`
remain unchanged. `refresh.json` records the 30 October 2026 same-line updates,
exact official release URLs, source commits, checksums and complete original
notices. The small named `0029-native-dependency-refresh.patch` selects these
archives through the engine's existing `download.lst` and build rules.

| Component | Released engine pin | Refreshed pin |
| --- | --- | --- |
| OpenSSL (3.5 LTS) | 3.5.8 | 3.5.9 |
| curl | 8.22.0 | 8.23.0 |
| Python | 3.14.7 | 3.14.10 |
| Poco | 1.15.3 | 1.15.4 |
| HarfBuzz | 14.3.0 | 14.6.0 |
| ICU and data | 78.2 | 78.3 |
| SQLite | 3.52.0 | 3.54.1 |

OpenSSL, Python and Poco include official security fixes. HarfBuzz includes
malformed-font fixes; curl, ICU and SQLite retain their selected upstream
release families. The release-note links in `refresh.json` document the actual
changes. curl removed SMB, which this engine already disabled; the patch removes
its obsolete disable flags. The existing Python ELF-rpath patch is rebased only
for upstream Makefile context changes. Its two rpath operations are preserved.
The configure constants match Python 3.14.10 and ICU 78.3.

`agent/packaging/office/source_graph.py` verifies the pristine source separately,
applies the recorded dependency patch to a small temporary copy and evaluates
the released `Makefile.fetch`. `sources.json` is the resulting configured native
graph. Its pristine/effective list hashes, refresh hash and patch hashes prevent
a stale graph from selecting old archives. The same patch is registered in the
existing Linux and native Termux build owner. Native SBOM generation reads the
patched engine list; source/legal assembly uses the same original archive pins.

Downloaded archives and split parts remain outside Git in
`BASHKITTEN_SOURCE_CACHE`. Prepare the cache through the existing source owner,
then build with `BASHKITTEN_OFFLINE_SOURCES=1`. Corresponding-source artifacts
include the original archives and named patches. Files in `licenses/` are exact
original full legal files or complete inline legal preambles; `refresh.json`
records their archive members, checksums and byte ranges when needed. The
existing runtime legal owner adds these notices to the installed offline
license inventory and retains the refreshed Python wheels' own notices.

The native Termux libcap 2.78 and libiconv 1.19 pins were checked against the
official kernel.org and GNU release indexes on 30 October and remain current.
Their source archives, build configuration and full license texts are unchanged.

Focused source/build checks verified all 121 configured archives from the warm
external cache, strict shared/Termux patch application, both native configured
source graphs, all refreshed notices against the original archive bytes, and
Python wheel legal collection. All selected dependency patch sequences apply
with zero fuzz. These checks establish source/build-input integrity. The normal
GitHub Actions native builds and changed installed flows still need to verify
the newly compiled runtime; earlier runtime evidence retains its original pins.
