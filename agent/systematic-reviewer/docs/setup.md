# Shared service setup

`/review-setup [status|openalex] [PROJECT]` is a user-invoked Pi command. It lists
safe configuration status and offers native References settings, key entry or
removal. Keys are sent directly to the existing private backend settings owner;
they do not enter model messages, reference snapshots or another credential store.
If several projects are available, select the intended authorized project.

Outside Pi use `node scripts/setup.mjs --help`. `status --project PROJECT`
returns safe configuration. `set openalex --project PROJECT` reads a hidden
terminal entry; `--stdin` explicitly accepts a pipe. `remove openalex` removes the
saved key. An ordinary local CLI also supplies `--session CHAT_ID` so the existing
owner resolves its authority. `open` prints the normal References URL.
No temporary browser server or alternate authentication path is created.

References supports keyless OpenAlex access where available; configured status
does not prove key validity or quota. The user can obtain a key from
[OpenAlex settings](https://openalex.org/settings/api). Do not ask for keys in
chat or put them in command arguments, logs or repository files. Shared settings
also own Crossref/Unpaywall contact information and unchanged custom-resolver JSON.
