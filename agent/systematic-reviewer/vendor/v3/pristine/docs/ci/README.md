# Optional Linux CI template

[github-actions.yml](github-actions.yml) defines native Linux amd64 and arm64
checks on Node 22.19 and 24: offline tests, resource checks, synthetic exports,
Pi's real loader and npm package contents.

It is **not active**. The GitHub OAuth credential used for this implementation
has repository access but lacks `workflow` scope, so GitHub rejected a push
containing a new Actions workflow. No authentication permissions were changed.
The implementation was published with this non-executable template instead.

A repository maintainer with suitable workflow permissions can copy the template
to `.github/workflows/test.yml` and commit it on `V3`. Review it before enabling
it; the workflow only needs read access to repository contents. It installs the
Pi host peers into the CI checkout, not into a system/global Pi installation.

Until a Linux CI run completes, the amd64/arm64 targets are portable-code design
targets; the recorded execution evidence is aarch64 Android Termux. Office tests
are optional and separate, and neither these checks nor the CI template can
validate a real Zotero toolbar Refresh without the installed integration.
