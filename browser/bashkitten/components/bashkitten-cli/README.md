# Native browser control

The BashKitten executable exposes the browser's ordinary-tab controls. Linux
uses its private Unix socket; Android uses native Binder approval. The protected
Agent view is outside this interface.

The supported Pi extension and separate desktop/mobile skills are packaged from
`agent/pi/`. This directory retains the original command integration's licenses
and attribution; there is no separate browser-control client process.
