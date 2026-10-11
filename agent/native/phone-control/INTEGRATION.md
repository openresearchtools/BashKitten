# Phone controls integration

The adapted source lives in `browser/mobile/android/bashkitten/src/main/java/com/bashkitten/phone`.
It is compiled by the existing main APK library, not a separate donor application.

Manifest additions (root integrator owns the shared manifest):

- permissions `android.permission.ACCESS_COARSE_LOCATION`, `android.permission.ACCESS_FINE_LOCATION` (requested only by user).
- query intent MAIN / category LAUNCHER for visible apps; no QUERY_ALL_PACKAGES.
- service `com.bashkitten.phone.PhoneNotificationService`, exported true, permission `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`, intent action `android.service.notification.NotificationListenerService`.
- service `com.bashkitten.phone.PhoneAccessibilityService`, exported true, permission `android.permission.BIND_ACCESSIBILITY_SERVICE`, action `android.accessibilityservice.AccessibilityService`, metadata `android.accessibilityservice` resource `@xml/phone_accessibility`.
- activity `com.bashkitten.phone.PhoneFilesActivity`, exported false.
- activity `com.bashkitten.phone.PhoneShareActivity`, exported true, SEND/SEND_MULTIPLE content MIME `*/*`, DEFAULT category; it is inert with Files Off and never reads shared content in its callback.

Native Phone panel: `PhoneControlsPanel.build(Activity)` returns controls section.
Call `PhoneControlsPanel.refresh(view)` after Android permission/settings return.
All nine control switches default Off; the master retains choices but disables all.

Native controller calls `PhoneControlsRuntime.get(context).setOwnerLinkListener(link -> ...)`.
Deliver link through private Termux stdin to `phone-control-connect`. That command
must run in the owned backend process: `configurePhoneOwner(link)` keeps it only
in memory. Never expose it through HTTP/browser UI, Pi environments or logs.
On controller/Termux disconnection call `disconnectOwner()` and revoke owner slots.

The loopback contract is POST `/v1`, exact JSON content type, `{version:1,command,args}`.
`Authorization: Owner <secret>` only registers/revokes short worker leases.
`Authorization: Bearer <grant>` only discovers/executes currently enabled controls.
No web origins, redirects, generic intents, settings mutation or MCP methods exist.

All processes under Termux share one Android UID. Private sockets and scoped leases
prevent unprovisioned normal callers/other UIDs; they do not isolate malicious
same-UID code or a grant deliberately leaked by an authorized agent.
