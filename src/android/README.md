# Android host

`com.bashkitten`, Android 12+, system WebView and a native Compose control screen.
Product domain: bashkitten.com. There is no Android copy of the web UI or Pi.

The initial controller uses the suite-signed Termux setup activity and command
service. Public RUN_COMMAND/allow-external-apps settings are not needed. WebView
keeps its ordinary cookie store. File inputs use Android's normal picker;
authenticated local downloads stream into Downloads/BashKitten and open with
Android's associated app. Provider login helpers remain in a local WebView
popup sharing its cookies, while authorization links open externally.

Native store/service buttons are outside the web document. No JavaScript native
interface is registered. Remote and repository documents cannot navigate the
embedded app into a privileged page. TLS validation is never bypassed.

Build with the checked-in Gradle wrapper, JDK 17 and SDK 37. The candidate workflow
builds before a separate signing job, with signing Secrets only on main. It
checks the common Droid certificate and non-debuggable output. Gradle wrapper
scripts/JAR come from upstream Gradle via the pinned Termux X11 import and retain
their embedded Apache-2.0 notices; AndroidX dependencies retain their own licenses.

Implementation is in progress: signed-catalog installation/update rows,
resumable package bootstrap/jobs and desktop-profile controls are the next
pieces. A compiled candidate is not a release or evidence of device validation.
