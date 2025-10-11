import { WetherspoonsAPI } from "../src/apis/jdw-apps";
import { getTodaysDrinks } from "../src/wetherspoons";

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// These are sanity checks to make sure the zod schemas work against the S3 and Zonal API
// I'm not sure using Zod is a good idea but ¯\_(ツ)_/¯
// TODO: Actual testing framework

async function main() {

  console.log(`Testing JD Wetherspoons API...`)
  const venues = await WetherspoonsAPI.venues();
  console.log(`${venues.length} venues found`);

  for(const venue of venues) {
    if(venue.isClosed) continue;
    console.log(`Attempting to parse menu of ${venue.name} (${venue.venueRef})`)
    try{
      const drinks = await getTodaysDrinks(venue);
      console.log(`Found ${drinks.length} drinks`);
    } catch {
      console.log('Failed.')
    }
  }
  console.log('Done!');
}
main();

