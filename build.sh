cd ./wetherspoons-pub-fetcher
npm ci
npm run build
cd ..

cd ./wetherspoons-menu-fetcher
npm ci
npm run build
cd ..

cd ./wetherspoons-price-api
cd ./venueId-productId
npm ci
npm run build
cd ..
cd ..