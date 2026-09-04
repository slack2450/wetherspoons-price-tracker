#!/usr/bin/env bash

set -euo pipefail

assert_lambda_bundle() {
    local bundle_dir="$1"
    local archive="$bundle_dir/index.zip"
    local javascript_file
    local archive_entry
    local archive_javascript
    local found
    local scan_file
    local -a archive_entries

    mapfile -t archive_entries < <(unzip -Z1 "$archive")
    if ((${#archive_entries[@]} == 0)); then
        echo "Lambda archive is empty: $archive" >&2
        exit 1
    fi

    for javascript_file in "$bundle_dir"/*.js; do
        if grep -aFq "file:///" "$javascript_file"; then
            echo "Lambda bundle contains a build-machine file URL: $javascript_file" >&2
            exit 1
        fi
        archive_javascript="$(basename "$javascript_file")"
        found=false
        for archive_entry in "${archive_entries[@]}"; do
            if [[ "$archive_entry" == "$archive_javascript" ]]; then
                found=true
                break
            fi
        done
        if [[ "$found" != true ]]; then
            echo "Lambda archive is missing webpack chunk: $javascript_file" >&2
            exit 1
        fi
    done

    # Scan each archived file independently as well as the unpacked webpack
    # output. This catches machine-specific paths in lazy or unexpected chunks.
    scan_file="$(mktemp)"
    for archive_entry in "${archive_entries[@]}"; do
        unzip -p "$archive" "$archive_entry" > "$scan_file"
        if grep -aFq "file:///" "$scan_file"; then
            echo "Lambda archive entry contains a build-machine file URL: $archive:$archive_entry" >&2
            rm -f -- "$scan_file"
            return 1
        fi
    done
    rm -f -- "$scan_file"
}

self_test_bundle_scanner() {
    local test_dir
    test_dir="$(mktemp -d)"
    printf '%s\n' 'exports.handler = async () => ({ statusCode: 200 });' > "$test_dir/index.js"
    (
        cd "$test_dir"
        zip -q index.zip index.js
        printf '%s\n' '//# sourceMappingURL=file:///build-machine/private/source.js.map' > poison.js
        zip -q index.zip poison.js
        rm -f poison.js
    )
    if (assert_lambda_bundle "$test_dir") >/dev/null 2>&1; then
        echo "Bundle scanner self-test failed to detect an archived build-machine path" >&2
        rm -rf -- "$test_dir"
        return 1
    fi
    rm -rf -- "$test_dir"
    echo "Bundle scanner self-test passed"
}

if [[ "${1:-}" == "--self-test-scanner" ]]; then
    self_test_bundle_scanner
    exit
fi

# wetherspoons-pub-fetcher
cd ./wetherspoons-pub-fetcher
npm ci
npm test
npm run build
assert_lambda_bundle ./dist
cd ..

# wetherspoons-menu-fetcher
cd ./wetherspoons-menu-fetcher
npm ci
npm test
npm run build
assert_lambda_bundle ./dist
cd ..

# wetherspoons-run-monitor
cd ./wetherspoons-run-monitor
npm ci
npm run build
assert_lambda_bundle ./dist
cd ..

# wetherspoons-api
cd ./wetherspoons-api
cd ./proxy
npm ci
npm test
npm run build
assert_lambda_bundle ./dist
cd ..
cd ./price
npm ci
npm test
npm run build
assert_lambda_bundle ./dist
cd ..
cd ./rankings
npm ci
npm run build
assert_lambda_bundle ./dist
cd ..
cd ..

# wetherspoons-pub-ranker
cd ./wetherspoons-pub-ranker
npm ci
npm run build
assert_lambda_bundle ./dist
cd ..

echo "Build succesful!"
