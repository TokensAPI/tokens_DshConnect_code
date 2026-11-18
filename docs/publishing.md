# Private registry releases

The approved repository is `TokensAPI/tokens_DshConnect_code`; its package is
`@tokensapi/dsh-connect`, published to `https://npm.tokensapi.ai/` (Verdaccio).
Registry ACLs control access. Public source code does not imply public package
access, and public npm remains only a source for build dependencies.

## Setup and authorization

Configure the repository Actions secret `VERDACCIO_PUBLISH_TOKEN` through the
normal credential-management process. The authenticated publisher must be
`tokenscowork`; a market read-only credential cannot publish. Never commit
credentials or show `.npmrc` contents. Protect `v*` tags for release maintainers.
On a new fork, check the real Actions page for workflow enablement before an
authorized push: API `active` alone does not prove push triggers work.

Source optimization does not by itself authorize a commit, push or publication.
It does not install a package into user profiles or restart the application.

## Checks and tagged releases

`checks.yml` checks every branch push and pull request; `publish-npm.yml` accepts
only `v*` tag pushes. There is no manual dispatch release route. To retry a failed
release, re-run its original Actions run. If it already published the version,
the existence guard stops a second publish; verify the existing release before
planning any follow-up version. Do not delete or overwrite a published version.

Both workflows carry the same Node matrix (22.19.0 and 24). It covers the current
minimum and active tested LTS branches; `engines` specifies a minimum rather than
an upper cap, so later runtimes are not mechanically blocked. Extend the matrix
when adopting a new Node LTS. Passing this matrix does not certify future Node
majors. The release workflow deliberately repeats the check matrix because
`needs` cannot gate across workflow files. Its publish job depends on checks in
that same tagged run.

Dependency installation uses `npm ci --ignore-scripts` with the checked-in lock.
Checks install Chromium and run `npm run check`, which builds both entries, runs
unit tests and the browser regression, and validates package artifacts. Isolated
mock tests keep the event loop alive per test on Node 22, preserve real timer
cleanup when using fake timers, and fail stalled tests after 30 seconds. Generated
`lib/` is ignored in Git and built in CI, but remains in the published tarball.
The lock fixes build inputs; it does not constrain future host upgrades.

## Release validation

For an authorized release, add a changelog section and compare link, set the
manifest/lock version, and use the matching stable `v<version>` tag. Validation
rejects wrong repository identity, registry, package name, prerelease versions,
tag mismatches and missing bilingual market metadata.

The publish job builds and packs with `npm pack --ignore-scripts` because checks
already ran. It verifies the actual tarball's manifest, allowlisted paths,
runtime entries, CLI, patch, assets and legal files, then publishes that same
tarball with lifecycle scripts disabled and the private registry explicit.

Only the final publish step receives `NODE_AUTH_TOKEN`; setup-node supplies the
matching registry authentication configuration. Before publishing, the helper
checks publisher identity and the exact version. Only HTTP 404 confirms absence;
authentication, network and server failures stop the release. After publishing,
bounded queries check the exact package/version, `latest`, and SHA-512 integrity
against the local tarball. Pending availability is reported without republishing.
No tarballs are uploaded as public Actions artifacts.

## Installation and update boundaries

Users configure authorized registry access in the host profile. The panel uses
the host package manager's existing authentication to query the private source,
never publisher credentials or browser token storage. Installs retain preflight,
profile identity, cancellation, locking and recovery checks, and report when a
restart is required without restarting the app automatically.

New market metadata becomes visible only after a new version is published. A
package release does not itself change the market administrator's visibility or
source configuration. Local checks, remote CI, registry publication, real host
API contracts and live account/UI acceptance are separate evidence; see
[host compatibility](host-compatibility.md).

## Reproducing and releasing the 2.10.x source branch

The 2.10.0 package was published on 2026-11-11 from the PitWall integration.
Its archived sources, tests, dependency lock and build scripts are now retained
in this repository, based on main at `9a0b19713721ab9ee2956fe0ccbbc8346affce86`.
The archive import is a separate commit from the 2.10.1 fix, so the old default
and its opt-in replacement can be reviewed independently. Main's 2.9.8
session-admission regression remains present and part of `check:host`.

Use Node 22.19 or a newer supported Node release. A fresh checkout needs no
running TokensCowork instance or Bot credentials to build and run the offline
suite:

```sh
git clone https://github.com/TokensAPI/tokens_DshConnect_code.git
cd tokens_DshConnect_code
git switch fix/2.10.1-telegram-thinking-default
npm ci --ignore-scripts --registry=https://registry.npmjs.org/
git fetch --depth=1 --no-tags https://github.com/xmanrui/dsh-im.git c826bfa415d79669d8ebba206cf4a1eac554d8e2
npm run audit:im
npx playwright install chromium
npm run check
node scripts/validate-release.mjs v2.10.1
mkdir -p .release
npm pack --ignore-scripts --pack-destination .release
node scripts/verify-tarball.mjs .release/tokensapi-dsh-connect-2.10.1.tgz
```

`lib/` is generated by `npm run check` and deliberately stays outside Git.
The checked-in manifest and lock fix all build inputs; `npm pack` packages
those generated entries together with the runtime assets and legal files.
Upstream audit fingerprints explicitly record the four changed defaults.

For an authorized manual release, use the existing npm login without reading
or copying its credentials. Confirm `npm whoami --registry=https://npm.tokensapi.ai/`
returns `tokenscowork`, and confirm the exact version is absent (only a 404
counts as absence). Then publish the same inspected tarball:

```sh
npm publish .release/tokensapi-dsh-connect-2.10.1.tgz --ignore-scripts --registry=https://npm.tokensapi.ai/ --tag=latest --access=restricted
npm view @tokensapi/dsh-connect@2.10.1 version dist.integrity --registry=https://npm.tokensapi.ai/
npm view @tokensapi/dsh-connect dist-tags.latest --registry=https://npm.tokensapi.ai/
```

Download the exact version again using `npm pack --ignore-scripts` into a
separate directory and compare its SHA-256/SHA-512 with the inspected tarball.
Do not republish if verification is delayed. This manual route matches the
2.10.0 release procedure and does not require changing Actions secrets.
Push the source branch normally; avoid pushing a release tag after a manual
release because that would start a second publish attempt for the same version.
Future tag releases may use the gated workflow above once maintainers choose
that route. To roll back the default offered to new installations, move
`latest` to the previously verified version with a separate release decision;
do not delete versions or silently downgrade already installed profiles.
