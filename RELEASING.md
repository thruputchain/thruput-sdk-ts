# npm releases

The manual **Release package** workflow runs on `main` and defaults to
`dry_run: true`. It repeats all release checks, including both live-node suites,
then packs the client and previews publication. A dry-run does not publish or tag.

## First npm release

1. Confirm publishing access to the `@thruputchain` npm organization. Add a
   granular npm write token as the Actions secret `NPM_TOKEN`. It must permit
   package creation and non-interactive publication under the organization's
   2FA policy. Do not put tokens in files.
2. Publish the five protocol packages at **0.19.1** from `thruput-protocol-ts`.
3. Merge these changes and run the workflow with `dry_run: true`.
4. After explicit release approval, run it with `dry_run: false` to publish
   client **0.25.0**. Publish React **0.9.0** after the client is available.

`publishConfig` selects public npm. Dependency installs retain GitHub Packages
during this first release. Once all seven packages exist on npm, switch scope
configuration and lockfiles to npm and verify anonymous clean installs.

## Tags and retries

Publication creates `npm-v<version>` at the tested commit. Earlier `v<version>`
GitHub Packages tags stay unchanged. A retry skips an existing npm version only
if its tarball integrity matches the local package exactly. Different contents
or a tag at another commit stop the release. Retry from the same commit.

This private repository uses token authentication without public provenance.
Dry-run success does not prove npm scope ownership or token permissions.
