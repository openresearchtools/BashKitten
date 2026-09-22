<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# BashKitten licensing policy

BashKitten is distributed as a combined work under
`AGPL-3.0-or-later`. This choice applies strong copyleft to BashKitten-original
browser, automation, service, and user-interface work, including the
source-availability requirement for modified AGPL software used over a network.
The Agent server/UI and copied native integration retain their GPL-3.0-only
headers; GPLv3 section 13 governs their combination with the browser.

It does not erase or replace inherited licenses.

## License layers

| Material | Governing treatment |
| --- | --- |
| WildBuzzard-derived browser source | `AGPL-3.0-or-later` |
| Mozilla and Waterfox MPL files | Preserve MPL-2.0 notices; additionally distribute under AGPL-3.0-or-later only where MPL-2.0 section 3.3 permits |
| MPL files marked incompatible with Secondary Licenses | MPL only; exclude from any claim of AGPL secondary licensing |
| `adblock-rs` | MPL-2.0 notice retained |
| uBlock Origin code, scriptlets, resources, and lists | Retain the applicable GPL-3.0 notice and exact source revision |
| Other filter lists and data | Retain each asset's GPL, Creative Commons, attribution, or other terms |
| Third-party libraries | Their existing licenses |

The browser executable implements agent control directly. There is no separate
browser-control client or its Cargo dependency inventory.

Tor and its statically linked OpenSSL, libevent, and zlib dependencies require
exact upstream copyright and license notices. Browser packages carry the pinned
inventory and those legal files. The exact Tor source archive is a separate
checksum-pinned release artifact and must not enter the installed runtime.

AGPL is not a mechanism for converting third-party assets to AGPL. An asset
with unclear redistribution permission remains excluded until permission or a
clear upstream license is documented.

## Porting requirements

- Preserve every legal notice and the original Git author where history is
  available.
- Record the exact upstream repository and full commit for copied or generated
  code and data.
- Add an accurate SPDX identifier to new product files.
- Do not add an AGPL identifier to an inherited file if doing so would
  contradict its existing notice or the rights actually granted.
- Keep source-generation scripts and the preferred form for modification of
  generated assets.
- Make the complete corresponding source for every distributed build
  available from the release that provides that build.
- If a BashKitten AGPL component is modified and used through a network, keep
  an accessible source link in that component as required by AGPL section 13.

## Branding is not attribution

Product names, logos, promotional UI, partner configuration, service URLs,
telemetry, and updater endpoints may be removed or replaced. Copyright lines,
license headers, source notices, author credits, and license entries must not
be removed with them.

The bundled Agent/search/auth payloads have their own retained notices, which
are included in the complete product's offline About. Removed torrent and
custom browser search components are not part of BashKitten packages. Historical
donor provenance remains in Git history and `upstreams.toml`.
