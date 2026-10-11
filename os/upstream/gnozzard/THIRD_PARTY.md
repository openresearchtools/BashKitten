# Third-party software

## Resources

- Upstream: https://github.com/nokyan/resources
- Version: v1.8.0
- Commit: `0b0dfbc29b1295211493a4daadb005fa3d8a5555`
- License: GPL-3.0-or-later
- Location: `third_party/resources`

v1.8.0 is intentionally pinned because it supports GTK 4.10 and libadwaita
1.6, matching Debian 13. Later upstream versions require libadwaita 1.8.
Its AppStream metadata and `.typos.toml` retain their CC0-1.0 licences.
The packaged fork keeps the visible name **Resources** while using the unique
application ID `org.openresearchtools.GnozzardResources`; this prevents it from
overwriting or replacing a distribution-provided Resources installation.
It is distributed in the separate `gnozzard-resources` Debian package. That
package installs this upstream GPL-3.0-or-later license, this attribution file,
and the repository's complete Debian copyright metadata.

## Adwaita folder artwork

- Upstream: https://gitlab.gnome.org/GNOME/adwaita-icon-theme
- License: LGPL-3.0-only (also offered upstream under CC-BY-SA-3.0-US)
- Location: `data/icons/Gnozzard`

The scalable folder silhouette is GNOME Adwaita's native folder artwork with
only its blue colour values changed to the Gnozzard orange palette. GNOME
Project attribution is retained here and in the SVG source comments.

## Design reference: BuzzardOS

BuzzardOS was consulted as a behavioral reference only. No BuzzardOS source is
included in this repository.

- Upstream: https://github.com/openresearchtools/BuzzardOS
- Inspected commit: `94b6e7446f65a6b112a62b3c5f561669dc975585`
- License: AGPL-3.0-or-later
