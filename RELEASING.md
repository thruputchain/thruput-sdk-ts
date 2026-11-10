# npm releases

The manual **Release package** workflow runs on `main` and defaults to
`dry_run: true`. It repeats all release checks, including both live-node suites,
then packs the client and previews publication. A dry-run does not publish or tag.

## Releasing a version

1. Qualify the built SDK against the CLI and devnode pins in
   `scripts/integration-versions.json`, and update the pins first when the
   release targets a new runtime.
2. If the release needs new `@thruputchain/protocol`, `xdr`, or `contract-spec`
   versions, publish them from `thruput-protocol-ts` first and bump the exact
   dependency versions here.
3. Bump `version` in `package.json` (and `package-lock.json`) in a pull request
   titled for the release. Merge it to `main`.
4. Run the workflow with `dry_run: true` and review the packed contents.
5. After explicit release approval, run it with `dry_run: false`.
6. Publish the matching `@thruputchain/react` version after the client is
   available on npm.

Versions are immutable on npm. Never reuse a version number.

## Authentication

`publishConfig` selects the public npm registry. The workflow authenticates
with the Actions secret `NPM_TOKEN`: a granular npm write token for the
`@thruputchain` organization that permits non-interactive publication under the
organization's 2FA policy. Do not put tokens in files. Dry-run success does not
prove npm scope ownership or token permissions.

Releases currently carry no npm provenance attestation. Moving the publish step
to npm trusted publishing (OIDC) would remove the long-lived token and add
provenance; it requires the repository to be public and the package's trusted
publisher to be configured on npmjs.com.

## Tags and retries

Publication creates `npm-v<version>` at the tested commit. Earlier `v<version>`
tags from the GitHub Packages era stay unchanged. A retry skips an existing npm
version only if its tarball integrity matches the local package exactly.
Different contents or a tag at another commit stop the release. Retry from the
same commit.
