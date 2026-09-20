# Tested Pi runtime manifests

`index.json` lists exact dependency graphs supported by this adapter, separately
from the latest upstream release reported by npm. Hashes cover the complete
lockfile bytes. Installation uses npm's locked integrity checks with lifecycle
scripts disabled; it never modifies the package-owned dependency tree.

The bundled runtime remains 0.85.1. The 0.86.0 update passed all 13 shared tests on
native Linux arm64 with Node 22.22.1 and 24.13.1, and native Termux aarch64 on
Cuttlefish Android 17 with Node 24.18.0. That includes real Pi RPC against local
model fixtures, fixture OAuth, TLS, files, queues, compaction, notifications,
package journals and activation/rollback. Notification delivery to Android and
real-account OAuth are separate platform checks.

Stage an update in a retained runtime directory, wait for active turns/logins,
then atomically select it for RPC, services, history and the terminal launcher.
The previous graph stays available for rollback. Re-run the same tests for each
new manifest and platform; an npm release alone does not authorize activation.
