#!/usr/bin/env bash

set -euo pipefail

assert_lambda_bundle() {
    local bundle_dir="$1"
    local bundle="$bundle_dir/index.js"
    local archive="$bundle_dir/index.zip"

    if grep -Fq "file:///" "$bundle"; then
        echo "Lambda bundle contains a build-machine file URL: $bundle" >&2
        exit 1
    fi

    for javascript_file in "$bundle_dir"/*.js; do
        if ! unzip -Z1 "$archive" | grep -Fxq "$(basename "$javascript_file")"; then
            echo "Lambda archive is missing webpack chunk: $javascript_file" >&2
            exit 1
        fi
    done
}

# wetherspoons-pub-fetcher
cd ./wetherspoons-pub-fetcher
npm ci
npm run build
assert_lambda_bundle ./dist
cd ..

# wetherspoons-menu-fetcher
cd ./wetherspoons-menu-fetcher
npm ci
npm run build
assert_lambda_bundle ./dist
cd ..

# wetherspoons-api
cd ./wetherspoons-api
cd ./proxy
npm ci
npm run build
assert_lambda_bundle ./dist
cd ..
cd ./price
npm ci
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
