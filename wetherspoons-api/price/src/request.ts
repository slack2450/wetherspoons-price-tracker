export const PRICE_RANGES = ['24h', '7d', '30d', '1y'] as const;
export type PriceRange = typeof PRICE_RANGES[number];

export type PriceRequest = { venueId: string, productId: string, range: PriceRange };

export class RequestError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

export function parsePriceRequest(
  path: Record<string, string | undefined> | undefined,
  query: Record<string, string | undefined> | undefined,
): PriceRequest {
  const venueId = path?.venueId;
  const productId = path?.productId;
  const range = query?.range;
  if (!venueId || !productId) throw new RequestError('Missing venueId or productId', 404);
  if (!/^\d{1,10}$/.test(venueId) || !/^\d{1,10}$/.test(productId)) {
    throw new RequestError('Venue and product IDs must be 1 to 10 digits', 400);
  }
  const numericVenueId = Number(venueId);
  const numericProductId = Number(productId);
  if (!Number.isSafeInteger(numericVenueId) || numericVenueId <= 0
    || !Number.isSafeInteger(numericProductId) || numericProductId <= 0) {
    throw new RequestError('Venue and product IDs must be positive safe integers', 400);
  }
  if (!PRICE_RANGES.includes(range as PriceRange)) throw new RequestError('Unsupported price range', 400);
  return { venueId, productId, range: range as PriceRange };
}
