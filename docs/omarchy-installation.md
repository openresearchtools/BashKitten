# Taskarian on Omarchy

Taskarian's Linux releases include native `x86_64` and `aarch64` Arch packages
alongside the Debian installers. These are testing releases, not ready for
production. Packages retain the same browser, private Node/Pi runtime, container
helpers and guest packages as the corresponding Debian installer.

Install the repository setup package using the instructions in the
[Open Research Tools package repository](https://github.com/openresearchtools/apt/tree/main/pacman).
Then enable prereleases and install through the signed catalogue:

```sh
sudo openresearchtools-pacman-setup --apply --channel nightly
omarchy update
omarchy pkg add taskarian
```

The `nightly` catalogue follows published prereleases. Use `--channel stable` for
regular releases, or `--channel testing` for the combined view. Switching channels
does not automatically downgrade an installed version. The central publisher
refreshes hourly; newly uploaded packages appear after its next successful run.

Taskarian containers use their bundled rootless Podman, crun and helpers, with a
private image store, runtime directory and control sockets. A host Docker or
Podman socket is not required. The normal desktop user's systemd session,
`newuidmap`/`newgidmap`, subordinate UID/GID ranges and `/dev/fuse` must be usable.
Arch supplies the mapping tools in `shadow`. Taskarian reports missing runtime
prerequisites through its existing container controls.

For release maintainers, the main publisher converts its verified local Linux
DEBs before the initial upload. It does not download the new release again or
rebuild its compiled components. Debian and Arch packages share the release's
stable/prerelease flag and source/license index.
