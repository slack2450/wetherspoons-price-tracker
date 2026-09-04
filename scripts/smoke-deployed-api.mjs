import {
  collectorsAreOperational,
  londonHour,
  validateDrinksResult,
} from './deployed-api-contract.mjs';

const API_BASE = 'https://api.spoons.cheap';
const DIRECT_API_BASE = process.env.DIRECT_API_BASE;
const RETRIES = 12;
const CACHE_BUSTER = encodeURIComponent(process.env.GITHUB_SHA ?? Date.now().toString());

async function getJson(path) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await new Promise(resolve => setTimeout(resolve, 10_000));
    }
  }
  throw lastError;
}

if (!DIRECT_API_BASE) throw new Error('DIRECT_API_BASE is required');
const directResponse = await fetch(`${DIRECT_API_BASE}/v2/venues`, {
  signal: AbortSignal.timeout(30_000),
  headers: { Accept: 'application/json' },
});
if (directResponse.status !== 403) {
  throw new Error(`Direct API Gateway request returned ${directResponse.status}, expected 403`);
}

const venues = await getJson(`/v2/venues?range=deploy-${CACHE_BUSTER}`);
if (!Array.isArray(venues) || venues.length < 500) {
  throw new Error(`Deployed venue route returned ${Array.isArray(venues) ? venues.length : 'non-array'} venues`);
}

let available;
let checkedVenue;
for (const venue of venues.slice(0, 20)) {
  if (!Number.isSafeInteger(venue?.venueRef) || venue.venueRef <= 0) continue;
  const result = await getJson(`/v2/drinks/${venue.venueRef}?range=deploy-${CACHE_BUSTER}`);
  checkedVenue ??= venue;
  validateDrinksResult(result);
  if (result.status === 'available' && result.drinks.length > 0) {
    available = { venue, drink: result.drinks[0] };
    break;
  }
}

if (!available && collectorsAreOperational()) {
  throw new Error('No complete deployed drinks response found during collector operating hours');
}
if (!available && !checkedVenue) throw new Error('No valid deployed venue was available for route checks');

const venueRef = available?.venue.venueRef ?? checkedVenue.venueRef;
const productId = available?.drink.productId ?? 1;
if (!Number.isSafeInteger(productId) || productId <= 0) {
  throw new Error('Deployed drinks route returned an invalid product ID');
}

const history = await getJson(
  `/v2/price/${venueRef}/${productId}?range=24h`,
);
if (!Array.isArray(history)) throw new Error('Deployed price route returned a non-array response');

console.log(
  `DEPLOYED_API_SMOKE_OK venues=${venues.length} venue=${venueRef} product=${productId} history=${history.length} londonHour=${londonHour()} menu=${available ? 'available' : 'closed-hours'}`,
);
