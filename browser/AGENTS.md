# BashKitten browser source

Follow the repository root `AGENTS.md` and read
`docs/browser-integration-plan.md` in full before migration work. This directory
is the complete shared Gecko source root; run `mach` here. Build native targets
on GitHub Actions using the retained component-artifact and compiler-cache
workflow. Keep output, caches and product verification tools outside source.

The browser executable owns ordinary-tab control and the protected Agent view.
The Agent server, stock Pi and native integration package live under `/agent`;
tracked Caddy/Authelia/Tor sources live under `/auth`. Keep native Android Binder
and desktop Unix-socket authorization. Do not add a browser-control server,
custom agent loop or duplicate Pi skills under this tree.

Preserve upstream copyright/license notices and source pins. Product code lives
under `bashkitten/`; `bashkitten/UPDATING-FIREFOX.md` defines subtree ESR updates
and Firefox-aligned product versions. Keep the exact engine pin separate from
the product maintenance suffix. Preserve Mozilla's upstream tests, while product
verification fixtures and instrumentation stay outside this repository.
