---
name: ask-user
description: Ask an optional clarification or preference without pausing independent work.
---

Use `ask_user` for one concise optional question. Supply short suggested choices
when helpful; the user can always write a custom answer. Ask early and continue
useful independent work after the pending result. The attributed reply arrives in
this chat's normal steering queue. Apply it before continuing dependent work.

After 120 seconds the backend may report: “No response; proceed with the best
long-term solution.” State the reasonable assumption you use. A late answer is
an attributed follow-up. Never infer permission from silence or use this optional
mechanism for authorization that must be obtained before acting. Do not ask the
same pending question repeatedly or poll for an answer.
