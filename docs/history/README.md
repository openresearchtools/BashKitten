# Archive history mapping

The user-authorized 28 October 2026 cleanup removed reviewed downloaded
dependency archives from history beginning at `374a3082ac55210add264c1eab10495e7b6b6726`.
The parent `02d6b61c0e937ce16a93b9a613cf8f344e700a2d`, earlier history, the
original plan commit/tag and the separate Firefox donor commits are unchanged.

[Old-to-new commit IDs](2026-10-28-archive-commit-map.tsv) cover the 481 rewritten
commits, including the cache migration. No commit was dropped. Commit messages,
authors, timestamps and parent ordering are preserved; only the inventoried
archive paths were removed from historical trees. Seven existing tags follow
their mapped commits; their names are unchanged.

Historical build and acceptance records retain their original source IDs.
Use the table to locate their corresponding code after the rewrite; the mapping
does not relabel a historical artifact or establish a new test/build result.
Existing explicit links to the frozen original plan remain valid.

Current build recipes fetch exact HTTPS/checksum-pinned originals into
`BASHKITTEN_SOURCE_CACHE` and support a verified warm cache with
`BASHKITTEN_OFFLINE_SOURCES=1`. The accumulated implementation remains in the
current source tree. Earlier historical recipes were not retroactively changed:
checking out an earlier rewritten commit may require restoring its original
archive inputs from its matching source bundle before using those old recipes.

Full corresponding-source delivery includes original dependencies and notices
alongside the product source. The cache migration was checked with offline
source preparation, a byte-identical References connector build and the product
source serializer. It does not claim a new complete browser build or product
acceptance. The existing Node artifact provenance checks remain mandatory.
