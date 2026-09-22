# Native search dependencies

`python-primp` builds the pinned Rust/PyO3 source for Android/Bionic in the
upstream Termux build environment. It installs only into BashKitten's private
search directory. No Linux wheel or on-device compiler is used.

The build framework and Python/native package recipes are recorded by exact
commit in `agent/search/runtime-lock.json`. Its `python-lxml`,
`python-pymupdf`, `python-mupdf` and MuPDF remain ordinary Termux dependencies;
the package records Python's major/minor ABI and refuses an incompatible runtime.
No patches to these packages are needed. Their own package licenses apply.

The isolated `termux-system-dns.patch` changes primp's default Android DNS
selection to its existing Bionic `getaddrinfo` resolver. Hickory's Android
configuration discovery requires a Java Activity, which a Termux Python process
does not have. Explicit DNS overrides remain available, and TLS certificate
verification is unchanged. The upstream source archive stays unmodified; the
Termux build applies this patch in its staging tree.

The explicit libpython dependency follows Termux's `python-cryptography`
recipe at that revision. The 16 KB ELF check runs after installation into the
artifact staging directory. Actual Android import/search/PDF checks use the
assembled package on Cuttlefish.
