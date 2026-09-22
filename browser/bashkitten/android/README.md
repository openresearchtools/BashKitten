<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# BashKitten for Android

BashKitten combines the shared Firefox ESR browser with a protected Agent view.
The Agent server and stock Pi run separately in Termux. Compatible official,
F-Droid and independently signed Termux installations use the same native
permission flow.

The browser keeps normal tabs, private tabs, Tor, downloads and Android file
uploads. Approved apps control ordinary tabs through native Binder; the Agent
view and its credentials stay outside that interface. See [API.md](API.md).
The shared Pi integration and mobile/desktop skills are packaged from
[`agent/pi`](../../../agent/pi/).

Build the APK through this repository's GitHub Actions workflow. It preserves
BashKitten's Android package/signing identity and shares the exact Firefox ESR
pin with Linux. Offline About and Licenses include the resolved Android/native
notices; original Mozilla, Waterfox, WildBuzzard and dependency attribution stays
with the source.
