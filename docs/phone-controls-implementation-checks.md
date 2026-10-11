# Phone controls and guest browser component checks

11 October 2026. Requirements remain the agreed plan at
`f71686dcb76402ec43bac3e6a7db8979ef0fb119` plus its authorized amendments.
This records component evidence, not installed-app acceptance.

## Phone controls

Pristine MIT donor import: `653010bc9d`. Main adaptation: `fa489c7939`.
The retained Android operations are attributed in
`agent/native/phone-control/ORIGIN.json`; the donor MCP application, providers,
tunnels, camera/audio features, callbacks and logging are not compiled.
The native module adds no third-party runtime dependency.

The nine native policy groups cover the retained applications/links,
notifications, SAF files/shares, clipboard, location, screen/elements, touch,
text/keys and navigation operations. The command table contains descriptors;
native dispatch creates request-scoped providers only after live authorization.
Disabled groups are absent from help/capabilities and fail before provider
creation. Master Off closes the listener. Worker/session adoption, owner loss,
feature changes and lease/deadline expiry invalidate work; request resources
and sockets are closed, including blocked streams and cancellable SAF queries.
Actions already handed to Android cannot be retracted.

The issue authority remains in the native module and owned backend controller.
Pi receives its worker socket/key, not the registrar, native owner or guest-browser
issue authority. Fork/session adoption uses the current native Pi identity.
Termux's same-UID trust limitation still applies; this is not isolation from
hostile code sharing that UID.

The packaging source includes `src/phone`; Termux gets the private-Node
`phoneuse` launcher and concise skill. Linux packaging removes that skill.
The explanatory skill can remain discoverable when Phone is Off; it contains
no permanent operation catalog and cannot obtain a grant or start the listener.
Final packaged notices and pristine-source delivery are checked by the shared
release/source collector workstream.

Checks completed:

- Android 37 `javac` compiled the Phone module, then all current BashKitten Java
  and Telephony sources together, with the newly built remote AAR. Real cached
  Gecko/AndroidX/support-utils libraries and generated resource classes supplied
  the external classpath; no source stubs replaced these modules. This does not
  validate a newly merged manifest, generated resources, Fenix Kotlin or APK.
- A real CLI process with isolated test sockets rejected an existing `--output`
  without deleting or changing it. Cleanup now removes only files the command
  successfully created exclusively.
- Native review added current-policy checks immediately before document creation,
  cancellation signals for SAF queries, protected-provider rejection for shares,
  screenshot boundary rechecks and cleanup of previous-process transient files.
  Inactive system bars alone do not disable screenshots. Keyboard dismissal
  does not navigate Back when no input-method window exists.

Android UI permission flows, all controls, native grant denial/revocation races,
physical OEM restrictions, traffic/content-log audit and Cuttlefish acceptance
remain part of the combined installed-candidate tests. These checks do not mark
plan section 12 complete.

## Container ordinary browser

The guest uses the existing BashKitten browser binary and existing browser
dispatcher. Explicit guest role, machine UUID, registered private profile,
installed browser executable, process parent/UID and user namespace are validated
by the live private controller before it gives a browser transport grant.
The protected Agent remains on the host. The helper never passes its owner
credential to Pi, pages or logs.

Service descriptor filesystem events only wake native reauthorization; file
contents do not grant control. An unchanged live backend keeps its channel.
Backend replacement cancels old work and obtains a fresh channel on the same
private route without replay. In-flight command IDs are not evicted from the
result cache. Closing the last ordinary window retains the guest browser runtime;
an explicit new-tab command uses the current `BrowserWindowTracker.openWindow`
API to reopen an ordinary window.

Checks completed:

- Node/Gecko-module syntax checks passed.
- A stalled Unix-socket request aborted promptly through `AbortSignal`.
- Private-route checks rejected TCP callers, page Origin, proxy ingress, invalid
  credentials and unknown operations.
- The actual relay process passed an isolated controller/backend transport test:
  an unchanged service descriptor kept its channel; replacing the owned service
  produced a fresh authorization and ready event; a stale old command result was
  discarded and the new command completed once, without replay.

The isolated fixtures/logs are under the separate build repository's `scratch`
directory. Installed Gecko window lifetime, guest provisioning, Display and
browser-tool acceptance still require the combined Linux candidate.
