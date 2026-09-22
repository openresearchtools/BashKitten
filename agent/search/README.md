# BashKitten Search

DDGS web search and a Markdown reader, bundled for Linux amd64/arm64 and native
Termux aarch64. Stock Pi discovers the accompanying `web-search` skill. The
helper accepts `{"query":"…"}` or `{"url":"https://…"}` on stdin and returns
JSON. URL reads save their complete extraction before shortening the preview.

Python and Git are platform packages. Linux includes its native search bindings;
Termux uses its native lxml/PyMuPDF packages alongside our private DDGS runtime.
No first-use pip installation or background service is required. Build records
and licenses accompany each runtime. See [notices](THIRD_PARTY_NOTICES.md).
