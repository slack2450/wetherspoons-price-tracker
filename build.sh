#!/usr/bin/env bash

# wetherspoons-pub-fetcher
cd ./wetherspoons-pub-fetcher
npm ci
npm run build
cd ..

# wetherspoons-menu-fetcher
cd ./wetherspoons-menu-fetcher
npm ci
npm run build
cd ..

# wetherspoons-api
cd ./wetherspoons-api
cd ./venueId-productId
npm ci
npm run build
cd ..
cd ..