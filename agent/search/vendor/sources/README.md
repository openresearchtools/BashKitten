# Retained search runtime sources

`sources.json` records the original source inputs selected by
`../../runtime-lock.json`: Python source distributions, the locked native
library source archives, the Rust crates selected by primp's existing Cargo
lock and its separately pinned full license texts. The archives are unchanged;
their SHA-256 values are the existing runtime/source-lock values. Each record's
`file` is relative to this directory and `licenses` lists paths in its archive
(or the retained text itself for a license record).

This inventory was materialized from the matching validated source release
inputs on 11 October 2026. It does not change versions, the native dependency
graph or the published wheel checksums. Builders may still download the exact
locked binary wheels, but their matching source must exist here and pass hash
verification before release source/notices preparation succeeds. Do not replace
missing source with a package from a workstation cache or a newer upstream ref.
