# Packaged settings view

This shared HTML/CSS/JavaScript renders settings details in Gecko. The application
menus and native controllers keep ownership of the operations. Providers and
General continue to use their existing protected Agent document and its selected
backend; they do not receive additional device authority.

`about:bashkitten-settings` is an unprivileged content document in a Gecko child.
The common About module loads the narrowly content-accessible
`chrome://bashkitten-settings/content/` package inside the Gecko archive.
JarMaker places the manifest and all shared assets together. The document keeps
its non-linkable `about:` content principal and uses Gecko's existing support for
loading local chrome modules from such pages; it gains no system principal or
native settings authority. Its CSP forbids
network connections, forms, embedded objects and remote scripts. Loading a copy
in an ordinary tab supplies no settings authority.

The native owner creates a dedicated view, enrolls its exact browser/session,
immutable section and backend ownership, and only then loads that fixed URI.
Actors check the current top WindowGlobal, exact document and content principal,
context and enrollment on every request and response. Each section has an
explicit method set. The page receives no tokens, cookies, native intent API or
generic command executor. It receives a frozen `bashkittenSettings` object with
`info`, `call(method, args)` and `subscribe(type, listener)`. Shared renderers use
`renderSection({root, call, subscribe, info, signal})`.

Autostart uses `autostart.get`, `autostart.set({id, enabled})` and
`autostart.commands.save({environmentId, revision, commands})`. Native adapters
resolve the current authoritative service flags and validate each target again
on mutation. The shared page stores no parallel startup choices. Its snapshot
contains grouped service entries and local execution environments, with command
configuration revisions and actual process states. Informational on-demand
services have no boolean startup field and therefore no pretend server switch.
Command edits keep their environment and revision; a concurrent agent edit must
be reported as a conflict, not overwritten. Opening or refreshing this page
does not start services or run commands. Managed-container settings retain their
native container identity and use that guest's private controller, configuration
and Pi profile; saved remote connections retain their separate encrypted route.

On Android, `AgentSettingsActivity` owns the private GeckoSession outside the
ordinary-tab registry. `BashKittenSettingsController` is its typed event seam;
`GeckoViewBashKitten` supplies only enrollment, visibility, event and close hooks.
The separate Settings actors cannot reuse or relax the HTTPS Agent enrollment.
Native Phone, Remote, Display and Share adapters preserve their existing owners.
Performance counters stop on pause/close. Temporary model checks have native
per-view ownership and cancellation, including late completion after closure.
Rotation/keyboard resizing retains the same settings session and form state.

The gear uses Fenix's existing menu components separately from the real browser
menu. Android's logo controls the native responsive sidebar. The Display viewport
has its own contextual setup gear; opening its settings does not stop the desktop.

Future Firefox updates should adapt these small session/actor/menu hooks, the
common About registration and resource packaging. The controllers and shared
renderers remain independent of browser chrome internals. Component compilation
and source review do not establish installed UI or security acceptance.
