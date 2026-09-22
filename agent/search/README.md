# BashKitten Search

DDGS web search and a Markdown reader, bundled for Linux amd64/arm64 and native
Termux aarch64. Stock Pi discovers the accompanying `web-search` skill. The
helper accepts `{"query":"…"}` or `{"url":"https://…"}` on stdin and returns
JSON. URL reads save their complete extraction before shortening the preview.

Python and Git are platform packages. Search dependencies are packaged privately;
no first-use installation or background service is required. Build records and
licenses accompany each native runtime. See [notices](THIRD_PARTY_NOTICES.md).
