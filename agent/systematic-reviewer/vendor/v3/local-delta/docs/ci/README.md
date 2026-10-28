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

Linux x86-64 checks have now been run locally with Node 22.22.1, alongside native
Android Termux x86-64 checks with Node 24.18.0. The original alpha also has native
Termux arm64 evidence. Linux arm64 still needs an actual run; CI remains inactive.
See the dated [validation log](../implementation-plan.md) for what each run
covered. Office checks are separate: offline tests and CI cannot establish a
successful Zotero Refresh without the installed standard integration.
