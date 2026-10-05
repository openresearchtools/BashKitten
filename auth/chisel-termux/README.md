# Native Chisel build

Build the complete pristine `../chisel` source pinned in `../upstreams.lock.json`
with the existing pinned Termux toolchain. There are no Chisel source patches.
The recipe selects Android/Bionic, the NDK external linker, PIE and 16 KB load
alignment, and installs in BashKitten's private directory. It neither runs a
public tunnel listener nor changes the upstream transport or authentication.

The browser's service-ID and Authelia integration is separate from this upstream
executable. Build success does not establish device or tunnel acceptance.
