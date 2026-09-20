# License inputs

Package builds retain upstream license files and generate an offline notice list
from the exact installed dependency graph. Android does the same for its resolved
release libraries, including license/notice files and source copyright headers.
Missing or unreviewed license texts stop the build.

`upstream/` supplements texts omitted from npm tarballs and records their source.
Pi uses its pinned upstream MIT license; AWS uses Apache-2.0. The clipboard
publisher declares MIT in its package metadata but supplies no separate license
file; its notice preserves that declaration, the standard MIT terms and original
credits. Rust standard-library notices use the compiler revision embedded in its native binary.
Its locked native crate notices are included, including other-target
and build dependency notices. Esbuild's native notices include Go 1.26.4, x/sys
and the upstream xxhash license. Hash-wasm includes its embedded C notices.

`source-archives.json` pins the supplemental native/source archives by SHA-256.
`packaging/sources.py` verifies and includes them with release source. npm tarballs
remain integrity-checked against package-lock.json. Refresh these inputs when
changing their pinned packages; never replace upstream copyright or notice text.
