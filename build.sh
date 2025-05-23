#!/usr/bin/env bash

# lib
cd ./lib
npm ci
npm run build
cd ..

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
cd ./proxy
npm ci
npm run build
cd ..
cd ./price
npm ci
npm run build
cd ..
cd ./rankings
npm ci
npm run build
cd ..
cd ..

# wetherspoons-pub-ranker
cd ./wetherspoons-pub-ranker
npm ci
npm run build
cd ..

echo "Build succesful!"
