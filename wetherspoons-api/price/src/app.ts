'use strict';

import { timingSafeEqual } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createHistoryReader } from './history';
import type { HistoryReader } from './history';
import { parsePriceRequest, RequestError } from './request';

let defaultReader: HistoryReader | undefined;

type JsonResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
};

function json(statusCode: number, body: unknown): JsonResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': statusCode === 200 ? 'public, max-age=300, stale-while-revalidate=60' : 'no-store',
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

export async function handle(
  event: APIGatewayProxyEventV2,
  reader?: HistoryReader,
  expectedOriginSecret = process.env.API_ORIGIN_SECRET,
): Promise<JsonResponse> {
  // API Gateway remains internet-addressable, so require the secret header
  // injected by CloudFront before parsing or querying InfluxDB.
  if (!originAllowed(event, expectedOriginSecret)) return json(403, { error: 'Forbidden' });
  try {
    const request = parsePriceRequest(event.pathParameters, event.queryStringParameters);
    const selectedReader = reader ?? (defaultReader ??= createHistoryReader());
    return json(200, await selectedReader.read(request.venueId, request.productId, request.range));
  } catch (error) {
    if (error instanceof RequestError) return json(error.statusCode, { error: error.message });
    console.error('PRICE_HISTORY_FAILED', error);
    return json(502, { error: 'Price history is temporarily unavailable' });
  }
}

export const handler = (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => handle(event);
