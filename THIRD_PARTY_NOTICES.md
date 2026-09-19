# Third-party notices

BashKitten's frontend and Node adapter are GPL-3.0-only. The renderer is the existing
BashKitten UI; no third-party web frontend source or visual assets were copied.
Pi is invoked through its public RPC and SDK APIs without modification.
`package-lock.json` pins all runtime dependencies and tarball integrity hashes.
Transitive npm packages retain their own license files when installed.

## Pi 0.85.1

Packages: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`.
Source: https://github.com/earendil-works/pi
Commit: `d981de1229ef899957bbe968bc8dcda02a21f477`.
Pi owns the native agent, tools, providers, login and session history.

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## hash-wasm 4.12.0

Source: https://github.com/Daninet/hash-wasm
Used for portable Argon2id hashing of the local web password.

```text
MIT License

Copyright (c) 2020 Dani Biró

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Embedded C implementations might use other, similarly permissive licenses.
Check the beginning of the files from the /src directory.

Special thank you to the authors of original C algorithms:
- Alexander Peslyak <solar@openwall.com>
- Aleksey Kravchenko <rhash.admin@gmail.com>
- Colin Percival
- Stephan Brumme <create@stephan-brumme.com>
- Steve Reid <steve@edmweb.com>
- Samuel Neves <sneves@dei.uc.pt>
- Solar Designer <solar@openwall.com>
- Project Nayuki
- ARM Limited
- Yanbo Li dreamfly281@gmail.com, goldboar@163.comYanbo Li
- Mark Adler
- Yann Collet
```

## yazl 3.3.1

Source: https://github.com/thejoshwolfe/yazl
Used for streaming backend ZIP downloads.

```text
The MIT License (MIT)

Copyright (c) 2014 Josh Wolfe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development tooling

Playwright Core 1.63.0, Microsoft Corporation, Apache-2.0.
Source: https://github.com/microsoft/playwright
Used to control native Android Chromium during verification. It is omitted from
production installation with `npm ci --omit=dev --ignore-scripts`.

Notices for the removed Rust port and its former dependencies remain with that
code in Git history; they do not describe the current runtime.
