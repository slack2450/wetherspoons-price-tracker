import { WetherspoonsS3API } from "../src/apis/s3";
import { WetherspoonsZonalAPI } from "../src/apis/zonal";

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// These are sanity checks to make sure the zod schemas work against the S3 and Zonal API
// I'm not sure using Zod is a good idea but ¯\_(ツ)_/¯
// TODO: Actual testing framework

async function main() {

  console.log(`Testing S3 API...`)

  console.log('global()');
  const global = await WetherspoonsS3API.global();
  console.log('news()');
  await WetherspoonsS3API.news();
  console.log('searchTerms()');
  await WetherspoonsS3API.searchTerms();
  console.log('recipes()');
  await WetherspoonsS3API.recipes();
  console.log('tillRequests()');
  await WetherspoonsS3API.tillRequests();
  console.log('productLevelPopup()');
  await WetherspoonsS3API.productLevelPopup();
  console.log('relatedItems()');
  await WetherspoonsS3API.relatedItems();
  console.log('promotionalBanners()');
  await WetherspoonsS3API.promotionalBanners();
  console.log('appVersion()');
  await WetherspoonsS3API.appVersion();

  for (const venue of global.venues) {
    if (!venue.identifier) {
      console.log(`Skipping ${venue.name} (${venue.id})`);
      continue;
    };
    console.log(`Trying ${venue.name} (${venue.identifier})`);
    console.log('venue()');
    await WetherspoonsS3API.venue(venue.identifier);
    console.log('tables()');
    await WetherspoonsS3API.tables(venue.identifier);
    console.log('ales()');
    await WetherspoonsS3API.ales(venue.identifier);
    console.log('specials()');
    await WetherspoonsS3API.specials(venue.identifier);

    // Sometimes the endpoint doesn't exist and returns an S3 error
    try {
      console.log('piks()');
      await WetherspoonsS3API.piks(venue.identifier);
    } catch (e: any) {
      if (e.toString() !== `SyntaxError: Unexpected token '<', "<?xml vers"... is not valid JSON`)
        throw e;
    }

    console.log('outOfStock()');
    await WetherspoonsS3API.outOfStock(venue.identifier);

    try {
      console.log('productLevelPopupByVenue()');
      await WetherspoonsS3API.productLevelPopupByVenue(venue.identifier);
      break;
    } catch (e: any) {
      if (e.toString() !== `SyntaxError: Unexpected token '<', "<?xml vers"... is not valid JSON`)
        throw e;
    }
  }

  console.log('Testing Zonal API...')
  const venues = await WetherspoonsZonalAPI.venues();

  // TODO: A nicer backoff strategy
  for (const venue of venues.venues) {
    console.log(`Testing API endpoints for ${venue.name} ${venue.id}`);

    for (const salesArea of venue.salesArea) {
      console.log(`Sales area: ${salesArea.friendly} ${salesArea.id}`);

      for (let i = 0; i < 3; i++) {
        try {
          const menus = await WetherspoonsZonalAPI.getMenus({
            siteId: venue.id,
            salesAreaId: venue.salesArea[0].id
          });

          for (const menu of menus.menus) {
            console.log(`Menu: ${menu.name} ${menu.id}`);

            for (let j = 0; j < 3; j++) {
              try {
                const menuPage = await WetherspoonsZonalAPI.getMenuPages({
                  siteId: venue.id,
                  salesAreaId: salesArea.id,
                  menuId: menu.id,
                });
                if ('message' in menuPage) {
                  console.log(menuPage);
                }
                break;
              } catch (e) {
                console.log(e);
                console.log(`Retrying getMenuPages() in ${(j + 1) * 60} s`);
                if (j != 2) {
                  await sleep((j + 1) * 60 * 1000);
                }
              }
            }
          }

          break;

        } catch (e) {
          console.log(e);
          console.log(`Retrying getMenus() in ${(i + 1) * 60} s`);
          if (i != 2) {
            await sleep((i + 1) * 60 * 1000);
          }
        }
      }

    }

    // Sleep for Zonal doesn't kill me
    await sleep(1000);
  }
}

main();

