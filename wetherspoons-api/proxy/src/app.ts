import { timingSafeEqual } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getDrinks, type HighLevelVenue, venues } from 'wetherspoons-api';

const SERVER_UPSTREAM_DEADLINE_MS = 25_000;

export interface PublicApi {
  venues(): Promise<HighLevelVenue[]>
  drinks(venue: Pick<HighLevelVenue, 'venueRef'>): ReturnType<typeof getDrinks>
}

const defaultApi: PublicApi = {
  venues: () => venues({ timeoutMs: SERVER_UPSTREAM_DEADLINE_MS }),
  drinks: venue => getDrinks(venue, { timeoutMs: SERVER_UPSTREAM_DEADLINE_MS }),
};

type JsonResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
};

type VenueCache = { expiresAt: number, promise: Promise<HighLevelVenue[]> };
const venueCaches = new WeakMap<PublicApi, VenueCache>();
const VENUE_CACHE_MS = 60 * 60_000;

function response(statusCode: number, body: unknown, maxAge = 0): JsonResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge > 0
        ? `public, max-age=${maxAge}, stale-while-revalidate=60`
        : 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function originAllowed(event: APIGatewayProxyEventV2, expectedSecret: string | undefined): boolean {
  if (!expectedSecret) return false;
  const supplied = event.headers?.['x-origin-verify'] ?? event.headers?.['X-Origin-Verify'];
  if (!supplied) return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(expectedSecret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function knownVenues(api: PublicApi): Promise<HighLevelVenue[]> {
  const now = Date.now();
  const cached = venueCaches.get(api);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = api.venues();
  venueCaches.set(api, { expiresAt: now + VENUE_CACHE_MS, promise });
  try {
    return await promise;
  } catch (error) {
    venueCaches.delete(api);
    throw error;
  }
}

export async function handle(
  event: APIGatewayProxyEventV2,
  api: PublicApi = defaultApi,
  expectedOriginSecret = process.env.API_ORIGIN_SECRET,
): Promise<JsonResponse> {
  if (!originAllowed(event, expectedOriginSecret)) return response(403, { error: 'Forbidden' });

  try {
    if (event.rawPath === '/v2/venues') return response(200, await knownVenues(api), 3600);
    if (event.rawPath.startsWith('/v2/drinks/')) {
      const venueId = event.pathParameters?.venueId;
      if (!venueId || !/^\d{1,10}$/.test(venueId)) return response(400, { error: 'Invalid venue ID' });
      const venueRef = Number(venueId);
      if (!Number.isSafeInteger(venueRef) || venueRef <= 0) {
        return response(400, { error: 'Invalid venue ID' });
      }
      const venue = (await knownVenues(api)).find(candidate => candidate.venueRef === venueRef);
      if (!venue) return response(404, { error: 'Venue not found' }, 300);
      const result = await api.drinks(venue);
      return response(200, result, 300);
    }
    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error('PUBLIC_API_FAILED', error);
    return response(502, { error: 'Upstream menu data is temporarily unavailable' });
  }
}

export const handler = (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => handle(event);
