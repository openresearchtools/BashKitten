---
name: phoneuse
description: Use enabled phone controls from an authorized local session. Check status and discover available commands before acting.
---

# Phone

Run `phoneuse status`, then `phoneuse capabilities` through the shell. Read
`phoneuse help GROUP` only for the enabled group needed for the task. Commands
use `phoneuse GROUP ACTION`, for example `phoneuse apps list`, as shown by discovery.
They accept typed `--name value` arguments; complex arrays use `--args-json '{...}'`.
Only currently enabled commands appear. Permissions/settings are the user's
native Phone panel: commands cannot enable themselves or request extra access.

Use fresh screen/tree results before actions, verify the outcome, and respect
protected Agent/browser/settings surfaces. "Requested unconfirmed" is not proof
that an app opened or an action succeeded. Missing or redacted data is not empty
content to invent. Screenshots/file reads return a private file path; inspect that
file and remove temporary artifacts after use. File uploads use `--input PATH`,
reads/screenshots optionally use `--output NEW_PATH`. Large files stream.

Use a suitable `--timeout-ms` (up to 120000) and cancel with the shell's process
cancellation. A timeout/drop after submitting an action has uncertain delivery;
inspect current state instead of blindly repeating it. A stopped worker, session
transition, disabled control or revoked Android grant can invalidate access.
Report unavailable/denied accurately; do not use another transport or bypass.

This session's authorization is scoped and short-lived. Never copy its credential
or private socket to another process/user/chat, store it in configuration, or
include it in output. Programs within Termux share an Android UID; this is scoped
session authorization, not hostile-code isolation between Termux processes.
