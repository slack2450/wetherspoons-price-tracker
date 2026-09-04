#!/usr/bin/env bash
set -euo pipefail

package_lambda() {
  local bundle_dir="$1"
  local javascript_file
  local -a archive_files=()

  export LC_ALL=C
  for javascript_file in "$bundle_dir"/*.js; do
    if [[ ! -f "$javascript_file" ]]; then
      echo "No JavaScript files found in $bundle_dir" >&2
      return 1
    fi
    archive_files+=("$(basename "$javascript_file")")
  done

  (
    cd "$bundle_dir"
    rm -f -- index.zip
    touch -t 198001010000 -- "${archive_files[@]}"
    zip -X -q index.zip "${archive_files[@]}"
  )
}

self_test() {
  local first_dir
  local second_dir
  first_dir="$(mktemp -d)"
  second_dir="$(mktemp -d)"

  printf '%s\n' 'exports.handler = async () => ({ statusCode: 200 });' > "$first_dir/index.js"
  cp "$first_dir/index.js" "$second_dir/index.js"
  touch -t 202001010000 "$first_dir/index.js"
  touch -t 202501010000 "$second_dir/index.js"

  package_lambda "$first_dir"
  package_lambda "$second_dir"
  if ! cmp -s "$first_dir/index.zip" "$second_dir/index.zip"; then
    echo "Lambda packaging is not reproducible" >&2
    rm -rf -- "$first_dir" "$second_dir"
    return 1
  fi

  rm -rf -- "$first_dir" "$second_dir"
  echo "Lambda packaging self-test passed"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit
fi

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 BUNDLE_DIRECTORY" >&2
  exit 2
fi

package_lambda "$1"
