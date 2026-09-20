# Native integration fixture assets

`images/small.png` is the small deterministic image used by
`tests/server/integration.test.mjs` to verify file uploads, downloads and native
Pi image input. The local model and OAuth endpoint fixtures live alongside the
integration tests in `tests/server/`.

Run `npm test` with Node >=22.19, ripgrep and fd installed. These tests execute
unmodified Pi; no Rust implementation or differential porting fixtures are used.
