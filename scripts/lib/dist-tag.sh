# Sourced by the release scripts. Sets DIST_TAG, defaulting to latest, and
# stops on a value npm would not take as a dist-tag.
require_dist_tag() {
  DIST_TAG=${DIST_TAG:-latest}
  # npm refuses a tag it can read as a version range. Of the lowercase names,
  # those are `x` and `v` followed by a number, such as `v1`.
  if [[ ! "$DIST_TAG" =~ ^[a-z][a-z0-9-]*$ || "$DIST_TAG" =~ ^(x|v[0-9].*)$ ]]; then
    echo 'DIST_TAG must be a lowercase name such as latest or next, not a version' >&2
    exit 1
  fi
}
