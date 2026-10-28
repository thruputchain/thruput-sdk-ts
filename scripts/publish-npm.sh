#!/usr/bin/env bash
set -euo pipefail

case "${DRY_RUN:-true}" in
  true|false) ;;
  *) echo 'DRY_RUN must be true or false' >&2; exit 1 ;;
esac
DRY_RUN=${DRY_RUN:-true}
registry=https://registry.npmjs.org
npm_args=(--registry="$registry" --@thruputchain:registry="$registry")
version=$(jq -er .version package.json)
tag="npm-v$version"
commit=$(git rev-parse HEAD)
remote=$(git ls-remote origin "refs/tags/$tag")
if [[ -n "$remote" && "${remote%%[[:space:]]*}" != "$commit" ]]; then
  echo "Tag $tag already belongs to another commit" >&2
  exit 1
fi
if [[ "$DRY_RUN" == false ]]; then
  : "${NODE_AUTH_TOKEN:?Set the NPM_TOKEN repository secret before publishing}"
  npm "${npm_args[@]}" whoami
fi

artifacts=$(mktemp -d)
trap 'rm -rf "$artifacts"' EXIT
jq -e --arg registry "$registry" \
  '.publishConfig.registry == $registry and .publishConfig.access == "public"' package.json
name=$(jq -er .name package.json)
npm pack --json --pack-destination "$artifacts" > "$artifacts/pack.json"
tarball="$artifacts/$(jq -er '.[0].filename' "$artifacts/pack.json")"
integrity=$(jq -er '.[0].integrity' "$artifacts/pack.json")
status=$(curl --silent --show-error --output "$artifacts/registry.json" --write-out '%{http_code}' "$registry/$name/$version")
case "$status" in
  404)
    args=("$tarball" --access public --tag latest)
    if [[ "$DRY_RUN" == true ]]; then args+=(--dry-run); fi
    npm "${npm_args[@]}" publish "${args[@]}"
    ;;
  200)
    if [[ $(jq -er .dist.integrity "$artifacts/registry.json") != "$integrity" ]]; then
      echo "$name@$version already exists with different contents" >&2
      exit 1
    fi
    echo "$name@$version is already published with identical contents"
    ;;
  *) echo "Registry check failed for $name@$version: HTTP $status" >&2; exit 1 ;;
esac
if [[ "$DRY_RUN" == false && -z "$remote" ]]; then
  git tag "$tag" "$commit"
  git push origin "refs/tags/$tag"
fi
