# Pi runtime refresh and native message attribution — 19 October 2026

Source and component verification only. Installed Android, Wayland and real-Xorg
acceptance remains part of the combined candidate. The native plan's frozen
baseline `f71686dcb76402ec43bac3e6a7db8979ef0fb119` is unchanged.

## Released runtime and retained sources

Pi advances from 1.1.0 to the official
[v1.3.0 release](https://github.com/earendil-works/pi/releases/tag/v1.3.0),
published 15 October, at exact commit
`71023aec1546d6d677a65669c5665c0927ce0dd0`. The complete pristine archive has
SHA256 `986b809d6899c6b859cca6419f98f4cb599e58fb3b3503a5660fcbf7f9a61c47`.
Its MIT license matches both retained offline license copies. Pi is unmodified;
the existing native JSONL sessions and stock RPC/SDK APIs remain authoritative.
Experimental Pi Durable is not enabled.

Both direct Pi packages and all seven Pi runtime packages resolve to exactly
1.3.0. Provider SDK versions follow that release's exact dependencies. Upstream
removed chord/esbuild from the runtime, so their obsolete npm distributions are
removed from the runtime lock/source inventory. BashKitten's separate DOMPurify
and marked dependencies advance to 3.4.17 and 18.1.1. Pi TUI retains its own exact
marked 18.0.11 dependency. SheetJS and adapted Pillama/usage donor sources remain
at their existing pins; no adapted module is silently replaced.

The existing source verifier validates 126 locked archives, including the local
SheetJS distribution. `npm ci --offline --ignore-scripts --no-audit --no-fund`
succeeds using the cache populated exclusively from those retained archives.
The ordinary license collector produces 131 complete records, including all
installed npm dependencies and the existing product/model-downloader notices.
Release source delivery continues through the existing source collector.

## Attribution repair

Commit `529e270e40` fixes the installed case where identical text first sent from
voicemail and later from a call displayed the voicemail label twice. Submission
text alone is no longer a presentation identity. The live worker follows stock
RPC's ordered queue occurrences, observes native message consumption, then binds
that receipt to Pi's durable entry ID. This also handles equal messages sharing a
millisecond timestamp and steering preceding follow-up messages. Queue clearing,
editing and rebuilding retain the same submission identity where Pi proves the
remaining queue; unknown inputs remain unattributed.

Live events, saved browser history and read-only `chats` use the same resolver.
Forks/clones retain attribution through their inherited native IDs. No Pi history
is rewritten. Historical metadata without a native receipt cannot prove a source;
it displays the native content without guessing a label or reusing an attachment
presentation from an equal-text submission. A repaired installed app must repeat
the voicemail/call flow with new submissions and verify both live and reopened
history, queue edits, Stop/restart and forks.

## Bounded verification and limits

External stock-Pi RPC checks pass on the existing bundled Node 24.21.0 and the
newly prepared native Linux Node 24.22.0. A deterministic provider fixture lives
outside the product repository and performs no provider network requests.
Checks cover separate/private profile paths, inherited standalone overrides,
stock package registration, extension loading/deferred tool discovery, native
parser/cwd, equal phone-message sources, queued steering priority, native resume
without history writes, clone IDs and fork attribution. The isolated RPC process
has no live BashKitten backend coordinator; the subagent extension's six expected
session-start refusals are recorded explicitly, with no unexpected extension
errors. This does not verify installed subagent coordination or provider login.

Additional source checks cover equal-timestamp receipts, imported/legacy history,
session changes, queue clear/rebuild, transformed/handled commands and a 20,000
entry queue removal (about 2 ms). Syntax and diff checks pass. A network syscall
trace of the isolated Node 24.21.0 RPC run contains no IPv4/IPv6 network operations.
This narrow fixture observation does not establish whole-product traffic or
physical-device behavior.

The profile check seeds a separate temporary standalone Pi settings file and
conflicting inherited Pi paths, then registers BashKitten in its owned profile.
The standalone file remains byte-identical; HOME/cwd stay at the fixture's normal
home/project. The reported real standalone Pillama flag conflict was separately
traced to a BashKitten package registration predating private-profile isolation
(`b6c435807f`, 8 October 10:55 UTC). No standalone settings, credentials or
automatic cleanup migration are changed by this source update.

Evidence and fixtures are outside release inputs at
`/run/media/user/Data/BashkittenBuild/verification/pi-1.3.0-20261019/`.
Installed candidate/package reconciliation, real provider/OAuth behavior,
notifications/calls/questions/subagents and responsive full browser flows remain
required for combined acceptance.
