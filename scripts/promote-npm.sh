#!/usr/bin/env bash
# Point an npm dist-tag at a version that is already published. Nothing is
# republished: only the tag moves.
set -euo pipefail

case "${DRY_RUN:-true}" in
  true|false) ;;
  *) echo 'DRY_RUN must be true or false' >&2; exit 1 ;;
esac
DRY_RUN=${DRY_RUN:-true}
DIST_TAG=${DIST_TAG:-latest}
# npm refuses a tag it can read as a version range. Of the lowercase names,
# those are `x` and `v` followed by a number, such as `v1`.
if [[ ! "$DIST_TAG" =~ ^[a-z][a-z0-9-]*$ || "$DIST_TAG" =~ ^(x|v[0-9].*)$ ]]; then
  echo 'DIST_TAG must be a lowercase name such as latest or next, not a version' >&2
  exit 1
fi
version=${VERSION:?Set VERSION to the published version to promote}
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo 'VERSION must be an exact version such as 1.2.3' >&2
  exit 1
fi
registry=https://registry.npmjs.org
npm_args=(--registry="$registry" --@thruputchain:registry="$registry")
name=$(jq -er .name package.json)

# Only versions this repository released carry the tag publish-npm.sh pushes.
if [[ -z $(git ls-remote origin "refs/tags/npm-v$version") ]]; then
  echo "No npm-v$version tag: $version was not released from this repository" >&2
  exit 1
fi
status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$registry/$name/$version")
case "$status" in
  200) ;;
  404) echo "$name@$version is not published" >&2; exit 1 ;;
  *) echo "Registry check failed for $name@$version: HTTP $status" >&2; exit 1 ;;
esac

echo "Dist-tags of $name before:"
npm "${npm_args[@]}" dist-tag ls "$name"
if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run: would point $DIST_TAG at $name@$version"
  exit 0
fi
: "${NODE_AUTH_TOKEN:?Set the NPM_TOKEN repository secret before promoting}"
npm "${npm_args[@]}" whoami
npm "${npm_args[@]}" dist-tag add "$name@$version" "$DIST_TAG"
echo "Dist-tags of $name after:"
npm "${npm_args[@]}" dist-tag ls "$name"
